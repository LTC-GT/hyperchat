/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './ui/public/**/*.{html,js}'
  ],
  theme: {
    extend: {
      colors: {
        quibble: {
          bg: '#313338',
          sidebar: '#2b2d31',
          serverbar: '#1e1f22',
          members: '#2b2d31',
          input: '#383a40',
          hover: '#35373c',
          active: '#404249',
          blurple: '#5865f2',
          'blurple-h': '#4752c4',
          green: '#23a559',
          yellow: '#f0b232',
          red: '#da373c',
          text: '#f2f3f5',
          'text-s': '#b5bac1',
          'text-m': '#949ba4',
          divider: '#3f4147',
          mention: 'rgba(88,101,242,0.3)',
          modal: '#313338',
          overlay: 'rgba(0,0,0,0.7)'
        }
      }
    }
  },
  plugins: []
}
