/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Existing color mappings
        'vscode-bg-primary': 'var(--bg-primary)',
        'vscode-bg-secondary': 'var(--bg-secondary)',
        'vscode-bg-tertiary': 'var(--bg-tertiary)',
        'vscode-text-primary': 'var(--text-primary)',
        'vscode-text-secondary': 'var(--text-secondary)',
        'vscode-text-muted': 'var(--text-muted)',
        'vscode-border': 'var(--border)',
        'vscode-accent': 'var(--accent)',
        'accent-blue': 'var(--accent-blue)',
        'accent-green': 'var(--accent-green)',
        'accent-red': 'var(--accent-red)',
        'accent-yellow': 'var(--accent-yellow)',
        
        // VS Code semantic colors
        vscode: {
          editor: {
            background: 'var(--bg-primary)',
            foreground: 'var(--text-primary)',
            'line-highlight': 'var(--bg-secondary)',
            selection: 'var(--accent-blue)',
            'inactive-selection': 'var(--bg-tertiary)',
          },
          sidebar: {
            background: 'var(--bg-secondary)',
            foreground: 'var(--text-primary)',
            'section-header': 'var(--bg-tertiary)',
          },
          'activity-bar': {
            background: 'var(--bg-tertiary)',
            foreground: 'var(--text-secondary)',
            'active-foreground': 'var(--text-primary)',
          },
          'status-bar': {
            background: 'var(--accent-blue)',
            foreground: '#ffffff',
          },
          panel: {
            background: 'var(--bg-secondary)',
            border: 'var(--border)',
          },
          input: {
            background: 'var(--bg-tertiary)',
            foreground: 'var(--text-primary)',
            border: 'var(--border)',
            placeholder: 'var(--text-muted)',
          },
          dropdown: {
            background: 'var(--bg-secondary)',
            foreground: 'var(--text-primary)',
            border: 'var(--border)',
          },
          list: {
            'active-selection': 'var(--accent-blue)',
            'hover-background': 'var(--bg-tertiary)',
            foreground: 'var(--text-primary)',
          },
          button: {
            primary: 'var(--accent)',
            secondary: 'var(--bg-tertiary)',
            foreground: '#ffffff',
          },
          scrollbar: {
            slider: 'var(--border)',
            'slider-hover': 'var(--text-muted)',
          },
          tab: {
            'active-background': 'var(--bg-primary)',
            'inactive-background': 'var(--bg-secondary)',
            'active-foreground': 'var(--text-primary)',
            'inactive-foreground': 'var(--text-muted)',
            border: 'var(--border)',
          },
          notification: {
            background: 'var(--bg-secondary)',
            border: 'var(--border)',
            foreground: 'var(--text-primary)',
          },
          breadcrumb: {
            foreground: 'var(--text-secondary)',
            background: 'var(--bg-primary)',
          },
        },
        
        // Syntax highlighting colors (VS Code Dark+ palette)
        syntax: {
          comment: '#6a9955',
          keyword: '#569cd6',
          string: '#ce9178',
          function: '#dcdcaa',
          variable: '#9cdcfe',
          number: '#b5cea8',
          operator: '#d4d4d4',
          type: '#4ec9b0',
          constant: '#4fc1ff',
        },
      },
      
      // Spacing extensions
      spacing: {
        '0.5': '0.125rem',
        '1.5': '0.375rem',
        '2.5': '0.625rem',
        '3.5': '0.875rem',
        '18': '4.5rem',
        '22': '5.5rem',
        '72': '18rem',
        '84': '21rem',
        '96': '24rem',
      },
      
      // Border radius extensions
      borderRadius: {
        'none': '0',
        'sm': '0.125rem',
        DEFAULT: '0.25rem',
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        'vscode': '2px',
      },
      
      // Box shadow extensions
      boxShadow: {
        'vscode-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
        'vscode': '0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px 0 rgba(0, 0, 0, 0.4)',
        'vscode-md': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.4)',
        'vscode-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.4)',
        'vscode-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.4)',
        'vscode-inset': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.3)',
        'glow-blue': '0 0 0 1px var(--accent-blue)',
        'glow-green': '0 0 0 1px var(--accent-green)',
      },
      
      // Animation configuration
      animation: {
        'fade-in': 'var(--animate-fade-in, fadeIn 0.2s ease-in-out)',
        'fade-out': 'var(--animate-fade-out, fadeOut 0.2s ease-in-out)',
        'slide-in': 'var(--animate-slide-in, slideIn 0.2s ease-out)',
        'slide-out': 'var(--animate-slide-out, slideOut 0.2s ease-in)',
        'scale-in': 'var(--animate-scale-in, scaleIn 0.2s ease-out)',
        'scale-out': 'var(--animate-scale-out, scaleOut 0.2s ease-in)',
        'spin-slow': 'spin 3s linear infinite',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
      },
      
      // Animation duration and timing
      transitionDuration: {
        '0': '0ms',
        '150': '150ms',
        '200': '200ms',
        '250': '250ms',
        '300': '300ms',
        '350': '350ms',
        '400': '400ms',
        '500': '500ms',
      },
      
      transitionTimingFunction: {
        'ease-in-out-back': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'ease-out-back': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'ease-in-back': 'cubic-bezier(0.6, -0.28, 0.735, 0.045)',
      },
      
      // Width extensions
      width: {
        '70': '280px',
        'xs': '20rem',
        'sm': '24rem',
        'md': '28rem',
        'lg': '32rem',
        'xl': '36rem',
        '2xl': '42rem',
        '3xl': '48rem',
        '4xl': '56rem',
        '5xl': '64rem',
        'sidebar': 'var(--sidebar-width, 260px)',
        'activity-bar': 'var(--activity-bar-width, 48px)',
        'panel': 'var(--panel-width, 400px)',
      },
      
      // Height extensions
      height: {
        'sidebar': 'var(--sidebar-height, 100vh)',
        'panel': 'var(--panel-height, 300px)',
        'status-bar': 'var(--status-bar-height, 22px)',
        'activity-bar': 'var(--activity-bar-height, 100vh)',
      },
      
      // Min/max width/height
      minWidth: {
        'sidebar': 'var(--sidebar-min-width, 200px)',
        'panel': 'var(--panel-min-width, 300px)',
      },
      maxWidth: {
        'sidebar': 'var(--sidebar-max-width, 400px)',
        'panel': 'var(--panel-max-width, 600px)',
      },
      minHeight: {
        'status-bar': 'var(--status-bar-height, 22px)',
        'panel': 'var(--panel-min-height, 150px)',
      },
      maxHeight: {
        'panel': 'var(--panel-max-height, 600px)',
      },
      
      // Padding extensions
      padding: {
        'safe': 'env(safe-area-inset-bottom)',
      },
      
      // Z-index scale
      zIndex: {
        'dropdown': '1000',
        'modal': '1050',
        'popover': '1060',
        'tooltip': '1070',
        'notification': '1080',
        'sidebar': '50',
        'panel': '40',
        'status-bar': '60',
      },
    },
  },
  plugins: [],
}