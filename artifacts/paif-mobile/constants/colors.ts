// Exact HSL → sRGB conversions from the PAIF.fun website; no separate identity.
const colors = {
  light: {
    background: '#f2f7f5', foreground: '#172b24',
    card: '#fcfbf8', cardForeground: '#172b24',
    primary: '#15754b', primaryForeground: '#fcfbf8',
    secondary: '#e2eee8', secondaryForeground: '#172b24',
    muted: '#e3ede8', mutedForeground: '#557267',
    accent: '#178755', accentForeground: '#fcfbf8',
    destructive: '#e11414', destructiveForeground: '#fafafa',
    border: '#c9d9d1', input: '#babec4', text: '#172b24', tint: '#15754b',
    chart1: '#2eb88a', chart2: '#0d91c9', chart3: '#e6890f', chart4: '#1abc9c', chart5: '#b731d8',
  },
  dark: {
    background: '#0e1a16', foreground: '#f3f3ec',
    card: '#15231e', cardForeground: '#f3f3ec',
    primary: '#1ebe70', primaryForeground: '#0e1a16',
    secondary: '#23342d', secondaryForeground: '#f3f3ec',
    muted: '#23342d', mutedForeground: '#a4b7ae',
    accent: '#1ebe70', accentForeground: '#0e1a16',
    destructive: '#e11414', destructiveForeground: '#fafafa',
    border: '#2e4239', input: '#55585e', text: '#f3f3ec', tint: '#1ebe70',
    chart1: '#5cd6ad', chart2: '#49c0f3', chart3: '#f5b766', chart4: '#54e8ca', chart5: '#d587e8',
  },
  radius: 12.8,
};
export default colors;
