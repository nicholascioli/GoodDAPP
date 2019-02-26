// @flow
import React, { useCallback, useState } from 'react'
import { Text, View } from 'react-native'
import { TextInput } from 'react-native-paper'

import { Section, Wrapper } from '../common'
import { BackButton, NextButton, useScreenState } from '../appNavigation/stackNavigation'
import { receiveStyles as styles } from './styles'
import TopBar from '../common/TopBar'

export type AmountProps = {
  screenProps: any,
  navigation: any
}

const TITLE = 'Send GD'

const SendReason = (props: AmountProps) => {
  const { screenProps } = props

  const [screenState, setScreenState] = useScreenState(screenProps)
  const { reason } = screenState

  return (
    <Wrapper style={styles.wrapper}>
      <TopBar />
      <Section style={styles.section}>
        <Section.Row style={styles.sectionRow}>
          <View style={styles.inputField}>
            <Section.Title style={styles.headline}>For?</Section.Title>
            <TextInput focus={true} value={reason} onChangeText={reason => setScreenState({ reason })} />
          </View>
          <View style={styles.buttonGroup}>
            <BackButton mode="text" screenProps={screenProps} style={{ flex: 1 }}>
              Cancel
            </BackButton>
            <NextButton values={{ reason }} {...props} />
          </View>
        </Section.Row>
      </Section>
    </Wrapper>
  )
}

SendReason.navigationOptions = {
  title: TITLE
}

export default SendReason
