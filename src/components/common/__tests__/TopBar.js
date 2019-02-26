import React from 'react'

// Note: test renderer must be required after react-native.
import renderer from 'react-test-renderer'

const getComponentWithAccountProvider = (componentPath, context = { balance: 10 }) => {
  // Will then mock the LocalizeContext module being used in our LanguageSelector component
  jest.doMock('../../appNavigation/AccountProvider', () => {
    return {
      AccountContext: React.createContext(context)
    }
  })

  // you need to re-require after calling jest.doMock.
  return require(componentPath).default
}

const getTopBarWithContext = (context = { balance: 10 }) => {
  return getComponentWithAccountProvider('../TopBar', context)
}

describe('TopBar', () => {
  it('renders without errors', () => {
    const TopBar = getTopBarWithContext()
    const tree = renderer.create(<TopBar />)
    expect(tree.toJSON()).toBeTruthy()
  })

  it('matches snapshot without balance', () => {
    const TopBar = getTopBarWithContext()
    const component = renderer.create(<TopBar hideBalance />)
    const tree = component.toJSON()
    expect(tree).toMatchSnapshot()
  })

  it('matches snapshot with balance', () => {
    const TopBar = getTopBarWithContext()
    const component = renderer.create(<TopBar />)
    const tree = component.toJSON()
    expect(tree).toMatchSnapshot()
  })
})
