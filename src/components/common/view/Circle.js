// @flow
import React from 'react'
import { Platform, View } from 'react-native'
import { withStyles } from '../../../lib/styles'
import { theme } from '../../theme/styles'
import Text from './Text'

/**
 * Receives a number and a unit to display
 * @param {Props} props
 * @param {Number} [props.number] Number to show
 * @param {String} [props.unit] Units for the number
 * @param {Object} [props.elementStyles] Inner elements styles
 * @param {Object} [props.style] Outer element style
 * @returns {React.Node}
 */
class Circle extends React.Component {
  render() {
    const { children, number, subText, styles } = this.props
    return (
      <View style={[styles.mainBlock, !!subText && styles.alignMainBlockCenter]}>
        <View style={styles.circle}>
          <Text fontFamily="slab" style={styles.circleNumber} fontWeight="bold" fontSize={24} color="#ffffff">
            {number}
          </Text>
        </View>
        <View style={styles.text}>
          <Text fontFamily="Roboto" fontSize={18} color={theme.colors.darkGray}>
            {children}
          </Text>
          {subText}
        </View>
      </View>
    )
  }
}

const getStylesFromProps = ({ theme }) => {
  return {
    mainBlock: {
      alignItems: 'baseline',
      display: 'flex',
      flexDirection: 'row',
    },
    alignMainBlockCenter: {
      alignItems: 'center',
    },
    circleNumber: {
      display: Platform.select({
        web: 'block',
        default: 'flex',
      }),
      flex: 1,
      zIndex: 9999999,
      color: '#ffffff',
    },
    circle: {
      justifyContent: 'center',
      display: 'flex',
      backgroundColor: theme.colors.primary,
      borderRadius: Platform.select({
        web: '50%',
        default: 43 / 2,
      }),
      height: 43,
      // FIXME: RN
      ...Platform.select({
        web: {
          boxShadow: '6px 1px 0 rgba(12, 38, 61, 0.15)',
        },
      }),
      marginTop: theme.sizes.default,
      width: 43,
    },
    text: {
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingLeft: 13,
    },
  }
}

export default withStyles(getStylesFromProps)(Circle)
