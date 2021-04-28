import { assign, filter, find, first, flatten, isFinite, isNumber, map, once, toArray, uniq } from 'lodash'

import api from '../api/FaceVerificationApi'
import FaceTec from '../../../../lib/facetec/FaceTecSDK'
import { UITextStrings } from './UICustomization'
import { MAX_RETRIES_ALLOWED, resultFacescanProcessingMessage } from './FaceTecSDK.constants'

const {
  // Zoom verification session incapsulation
  FaceTecSession,

  // Zoom session status codes enum
  FaceTecSessionStatus,

  // Helper function, returns full description
  // for session status specified
  getFriendlyDescriptionForFaceTecSessionStatus,

  // Helper class, allows to customize Zoom UI
  FaceTecCustomization,
} = FaceTec.FaceTecSDK

// enrollment processor class
// former startVerification from the useFaceTecVerification hook simply translated to the class
// all closures vars now are instance vars, all functions are methods
export class EnrollmentProcessor {
  // session state variables
  isSuccess = false

  lastResult = null

  lastMessage = null

  enrollmentIdentifier = null

  resultCallback = null

  retryAttempt = 0

  uiObserver = null

  uiRootNode = null

  uiObserverTargets = {}

  constructor(subscriber, options = null) {
    const { maxRetries = MAX_RETRIES_ALLOWED } = options || {}

    assign(this, { subscriber, maxRetries })
  }

  // should be non-async for not confuse developers
  // By Zoom's design, EnrollmentProcessor should return
  // session result only via callbacks / subscriptions
  enroll(enrollmentIdentifier) {
    this.enrollmentIdentifier = enrollmentIdentifier

    // so we're just proxying call to the async _startEnrollmentSession
    this._startEnrollmentSession()
  }

  /**
   * Helper method for handle session completion
   */
  onFaceTecSDKCompletelyDone = once(() => {
    const { subscriber, isSuccess, lastMessage, lastResult } = this
    const { status } = lastResult || {}
    let latestMessage = lastMessage

    // unlisten UI changes
    this._unlistenSDKUIElements()

    // if no errors were thrown and server haven't returned specific status messages
    if (!latestMessage) {
      // setting last message from session status code it it's present
      latestMessage =
        isNumber(status) && status !== FaceTecSessionStatus.SessionCompletedSuccessfully
          ? getFriendlyDescriptionForFaceTecSessionStatus(status)
          : 'Session could not be completed due to an unexpected issue during the network request.'
    }

    // calling completion callback
    subscriber.onSessionCompleted(isSuccess, lastResult, latestMessage)
  })

  /**
   * Helper method that calls verification http API on server
   */
  async sendEnrollmentRequest() {
    // reading current session state vars
    const { lastResult, resultCallback, enrollmentIdentifier } = this

    // setting initial progress to 0 for freeze progress bar
    resultCallback.uploadProgress(0)

    // getting images captured
    const { faceScan, auditTrail, lowQualityAuditTrail, sessionId } = lastResult

    try {
      // preparing request payload
      const payload = {
        faceScan,
        sessionId,
        lowQualityAuditTrailImage: first(lowQualityAuditTrail),
        auditTrailImage: first(auditTrail),
      }

      // after some preparation notifying Zoom that progress is 10%
      resultCallback.uploadProgress(0.1)

      // calling API, if response contains success:false it will throw an exception
      await api
        .performFaceVerification(enrollmentIdentifier, payload, ({ loaded, total }) => {
          const uploaded = loaded / total

          if (uploaded >= 1) {
            // switch status message to processing once upload completed
            resultCallback.uploadMessageOverride(resultFacescanProcessingMessage)
          }

          // handling XMLHttpRequest upload progress from 10 to 80%
          resultCallback.uploadProgress(0.1 + 0.7 * uploaded)
        })
        .finally(() => {
          // last 20% progress bar will stuck in 'almost completed' state
          // white GoodServer will process uploaded FaceMap
          resultCallback.uploadProgress(1)
        })

      // if enrolled sucessfully - setting last message from server response
      const { resultSuccessMessage } = UITextStrings

      FaceTecCustomization.setOverrideResultScreenSuccessMessage(resultSuccessMessage)

      // updating session state vars
      this.isSuccess = true
      this.lastMessage = resultSuccessMessage

      // marking session as successfull
      resultCallback.succeed()
    } catch (exception) {
      this.handleEnrollmentError(exception)
    }
  }

  /**
   * @private
   */
  handleEnrollmentError(exception) {
    const { resultCallback, subscriber, retryAttempt, maxRetries } = this

    // if call failed - reading http response from exception object
    const { message, response } = exception

    // setting lastMessage from exception's message
    // if response was sent - it will contain message from server
    this.lastMessage = message

    if (response) {
      // if error response was sent
      const { enrollmentResult, error } = response
      const { isEnrolled, isLive, isDuplicate, isNotMatch } = enrollmentResult || {}

      // if isDuplicate is strictly true, that means we have dup face
      // despite the http status code this case should be processed like error
      const isDuplicateIssue = true === isDuplicate
      const is3DMatchIssue = true === isNotMatch
      const isLivenessIssue = false === isLive

      // if there's no duplicate / 3d match issues but we have
      // liveness issue strictly - we'll check for possible session retry
      if (!isDuplicateIssue && !is3DMatchIssue && isLivenessIssue) {
        const alwaysRetry = !isFinite(maxRetries) || maxRetries < 0

        // if haven't reached retries threshold or max retries is disabled
        // (is null or < 0) we'll ask to retry capturing
        if (alwaysRetry || retryAttempt < maxRetries) {
          // increasing retry attempts counter
          this.retryAttempt = retryAttempt + 1

          // showing reason
          resultCallback.uploadMessageOverride(error)

          // notifying about retry
          resultCallback.retry()

          subscriber.onRetry({
            reason: exception,
            match3d: !is3DMatchIssue,
            liveness: !isLivenessIssue,
            duplicate: isDuplicateIssue,
            enrolled: true === isEnrolled,
          })

          return
        }
      }
    }

    // the other cases (non-200 code or other issue that liveness / image quality)
    // we're processing like an error - cancelling session
    // this will trigger handleCompletion which in turn trigger ProcessingSubscriber.onSessionCompleted
    // which then rejects its promise and causes FaceTecSDK.faceVerification to throw which is caught by
    // useFaceTecVerification
    resultCallback.cancel()
  }

  /**
   * Zoom processor contract method. Calls by Zoom on some events (e.g. images were captured,
   * server call was completed etc). Allows to perform server call ot specify what
   * Zoom should do after server response returned (cancel / retry / succeed session)
   *
   * @see FaceTecSDK.ZoomFaceMapProcessor
   * @private
   */
  processSessionResultWhileFaceTecSDKWaits(sessionResult, faceScanResultCallback) {
    const { subscriber } = this

    // updating session state variables
    this.lastResult = sessionResult
    this.resultCallback = faceScanResultCallback

    // checking the following cases
    // 1. Processor is called but session is still in progress. That means we've reached timeout
    // 2. New data (probably with better quality) came while session calling server.
    if (sessionResult.status !== FaceTecSessionStatus.SessionCompletedSuccessfully) {
      // on both cases described above we're cancelling current XMLHttpRequests
      // then cancelling current session
      api.cancelInFlightRequests()
      faceScanResultCallback.cancel()
      return
    }

    // if no session in progress - notifying that caturing is done
    subscriber.onCaptureDone()

    // and performing http server call
    this.sendEnrollmentRequest()
  }

  /**
   * generates session ID and starts session
   * enroll call proxies here - just for keep non-async
   * interface with onComplete callback designed by Zoom
   * @private
   */
  async _startEnrollmentSession() {
    const { OrientationChangeDuringSession } = FaceTecSessionStatus
    const { subscriber, _waitForSDKUIElementVisible, _failEnrollmentSession } = this

    try {
      // trying to retrieve session ID from Zoom server
      const sessionId = await api.issueSessionToken()

      // notifying subscriber that UI is ready
      _waitForSDKUIElementVisible('DOM_FT_getReadyActionButton', () => subscriber.onUIReady())

      // sometimes SDK doesn't recognizes orientation changhe during initializetion
      // and shows camera permissions popup. need to handle it manually and finish
      // the session with corresponding error code
      _waitForSDKUIElementVisible('DOM_FT_cameraPermissionsScreen', () => {
        alert('got dialog')

        // also session is stuck in such case, so we need to perform UI cleanup
        this._cleanSDKUIElements()
        _failEnrollmentSession(OrientationChangeDuringSession)
      })

      // if we've got it - strting enrollment session
      new FaceTecSession(this, sessionId)
    } catch ({ message }) {
      // otherwise calling completion handler with empty faceTecSessionResult
      this._failEnrollmentSession(message)
    }
  }

  /**
   * Fails enrollment session with message/optional code specifid
   * @param {String|Number} messageOrCode Error message or FaceTec SDK session status code
   * @private
   */
  _failEnrollmentSession = messageOrCode => {
    const isCodeBeenPassed = isNumber(messageOrCode)

    this.isSuccess = false
    this.latestMessage = isCodeBeenPassed ? null : messageOrCode
    this.lastResult = isCodeBeenPassed ? { status: messageOrCode } : null

    this.onFaceTecSDKCompletelyDone()
  }

  /**
   * Awaits the specific UI element becomes visible
   * @param {String} id ID attribute of the UI element
   * @param {Function} callback Callback function to call
   * @private
   */
  _waitForSDKUIElementVisible = (id, callback) => {
    let { uiObserver, uiObserverTargets, uiRootNode } = this

    if (!uiObserver) {
      const ObserverClass = window.WebKitMutationObserver || MutationObserver

      uiObserver = new ObserverClass(mutations => {
        const nodesAdded = uniq(flatten(map(filter(mutations, { type: 'childList' }), 'addedNodes').map(toArray)))

        if (!uiRootNode) {
          uiRootNode = find(nodesAdded, { id: 'DOM_FT_PRIMARY_TOPLEVEL_mainContainer' })

          if (uiRootNode) {
            assign(this, { uiRootNode })

            uiObserver.disconnect()
            uiObserver.observe(uiRootNode, {
              subtree: true,
              attributes: true,
              attributeFilter: ['id', 'style', 'className'],
            })
          }

          return
        }

        const nodesAffected = uniq(map(filter(mutations, { type: 'attributes' }), 'target'))

        for (const node of nodesAffected) {
          const { id, offsetParent } = node

          if (id && id in uiObserverTargets && offsetParent !== null) {
            const callback = uiObserverTargets[id]

            delete uiObserverTargets[id]
            callback()
          }
        }
      })

      uiObserver.observe(document.body, { childList: true })
      assign(this, { uiObserver })
    }

    uiObserverTargets[id] = callback
  }

  /**
   * Stops listening FaceTec SDK UI
   * @private
   */
  _unlistenSDKUIElements() {
    const { uiObserver, uiRootNode } = this

    this.uiObserverTargets = {}

    if (uiRootNode) {
      this.uiRootNode = null
    }

    if (uiObserver) {
      uiObserver.disconnect()
      this.uiObserver = null
    }
  }

  /**
   * CleansFaceTec SDK UI elements from DOM in the case of unexpected error
   * @private
   */
  _cleanSDKUIElements() {
    const { uiRootNode } = this

    if (uiRootNode) {
      alert('clean UI')

      /*const { previousSibling, nextSibling } = uiRootNode

      ;[previousSibling, nextSibling].forEach(node => {
        if (node.tagName === 'IFRAME') {
          node.remove()
        }
      })*/

      uiRootNode.remove()
    }
  }
}
