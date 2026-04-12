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
        // Design Token Colors - Background
        'vscode-bg-primary': 'var(--vscode-bg-primary)',
        'vscode-bg-secondary': 'var(--vscode-bg-secondary)',
        'vscode-bg-tertiary': 'var(--vscode-bg-tertiary)',
        'vscode-bg-elevated': 'var(--vscode-bg-elevated)',
        'vscode-bg-hover': 'var(--vscode-bg-hover)',
        'vscode-bg-active': 'var(--vscode-bg-active)',
        
        // Design Token Colors - Text
        'vscode-text-primary': 'var(--vscode-text-primary)',
        'vscode-text-secondary': 'var(--vscode-text-secondary)',
        'vscode-text-muted': 'var(--vscode-text-muted)',
        'vscode-text-disabled': 'var(--vscode-text-disabled)',
        'vscode-text-inverse': 'var(--vscode-text-inverse)',
        
        // Design Token Colors - Border
        'vscode-border': 'var(--vscode-border)',
        'vscode-border-light': 'var(--vscode-border-light)',
        'vscode-border-focus': 'var(--vscode-border-focus)',
        
        // Design Token Colors - Accent Primary
        'vscode-accent-primary': 'var(--vscode-accent-primary)',
        'vscode-accent-primary-hover': 'var(--vscode-accent-primary-hover)',
        'vscode-accent-primary-active': 'var(--vscode-accent-primary-active)',
        'vscode-accent-primary-subtle': 'var(--vscode-accent-primary-subtle)',
        
        // Design Token Colors - Accent Success
        'vscode-accent-success': 'var(--vscode-accent-success)',
        'vscode-accent-success-hover': 'var(--vscode-accent-success-hover)',
        'vscode-accent-success-subtle': 'var(--vscode-accent-success-subtle)',
        
        // Design Token Colors - Accent Warning
        'vscode-accent-warning': 'var(--vscode-accent-warning)',
        'vscode-accent-warning-hover': 'var(--vscode-accent-warning-hover)',
        'vscode-accent-warning-subtle': 'var(--vscode-accent-warning-subtle)',
        
        // Design Token Colors - Accent Error
        'vscode-accent-error': 'var(--vscode-accent-error)',
        'vscode-accent-error-hover': 'var(--vscode-accent-error-hover)',
        'vscode-accent-error-subtle': 'var(--vscode-accent-error-subtle)',
        
        // Design Token Colors - Accent Info
        'vscode-accent-info': 'var(--vscode-accent-info)',
        'vscode-accent-info-hover': 'var(--vscode-accent-info-hover)',
        'vscode-accent-info-subtle': 'var(--vscode-accent-info-subtle)',
        
        // Design Token Colors - Interactive
        'vscode-interactive-hover': 'var(--vscode-interactive-hover)',
        'vscode-interactive-active': 'var(--vscode-interactive-active)',
        'vscode-interactive-selected': 'var(--vscode-interactive-selected)',
        
        // Design Token Colors - Code
        'vscode-code-background': 'var(--vscode-code-background)',
        'vscode-code-border': 'var(--vscode-code-border)',
        
        // VS Code semantic colors
        vscode: {
          editor: {
            background: 'var(--vscode-bg-primary)',
            foreground: 'var(--vscode-text-primary)',
            'line-highlight': 'var(--vscode-bg-secondary)',
            selection: 'var(--vscode-accent-primary)',
            'inactive-selection': 'var(--vscode-bg-tertiary)',
          },
          sidebar: {
            background: 'var(--vscode-bg-secondary)',
            foreground: 'var(--vscode-text-primary)',
            'section-header': 'var(--vscode-bg-tertiary)',
          },
          'activity-bar': {
            background: 'var(--vscode-bg-tertiary)',
            foreground: 'var(--vscode-text-secondary)',
            'active-foreground': 'var(--vscode-text-primary)',
          },
          'status-bar': {
            background: 'var(--vscode-accent-primary)',
            foreground: '#ffffff',
          },
          panel: {
            background: 'var(--vscode-bg-secondary)',
            border: 'var(--vscode-border)',
          },
          input: {
            background: 'var(--vscode-bg-tertiary)',
            foreground: 'var(--vscode-text-primary)',
            border: 'var(--vscode-border)',
            placeholder: 'var(--vscode-text-muted)',
          },
          dropdown: {
            background: 'var(--vscode-bg-secondary)',
            foreground: 'var(--vscode-text-primary)',
            border: 'var(--vscode-border)',
          },
          list: {
            'active-selection': 'var(--vscode-accent-primary)',
            'hover-background': 'var(--vscode-bg-hover)',
            foreground: 'var(--vscode-text-primary)',
          },
          button: {
            primary: 'var(--vscode-accent-primary)',
            secondary: 'var(--vscode-bg-tertiary)',
            foreground: '#ffffff',
          },
          scrollbar: {
            slider: 'var(--vscode-border)',
            'slider-hover': 'var(--vscode-text-muted)',
          },
          tab: {
            'active-background': 'var(--vscode-bg-primary)',
            'inactive-background': 'var(--vscode-bg-secondary)',
            'active-foreground': 'var(--vscode-text-primary)',
            'inactive-foreground': 'var(--vscode-text-muted)',
            border: 'var(--vscode-border)',
          },
          notification: {
            background: 'var(--vscode-bg-secondary)',
            border: 'var(--vscode-border)',
            foreground: 'var(--vscode-text-primary)',
          },
          breadcrumb: {
            foreground: 'var(--vscode-text-secondary)',
            background: 'var(--vscode-bg-primary)',
          },
        },
        
        // Syntax highlighting colors (Vercel/Linear palette)
        syntax: {
          comment: '#6b7280',
          keyword: '#a78bfa',
          string: '#34d399',
          function: '#60a5fa',
          variable: '#67e8f9',
          number: '#fb923c',
          operator: '#9ca3af',
          type: '#22d3ee',
          constant: '#818cf8',
        },
      },
      
      // Typography - Font Families
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['Geist Mono', 'SF Mono', 'Monaco', 'Cascadia Code', 'monospace'],
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      
      // Typography - Font Sizes
      fontSize: {
        'vscode-xs': ['var(--vscode-font-size-xs)', { lineHeight: 'var(--vscode-line-height-normal)' }],
        'vscode-sm': ['var(--vscode-font-size-sm)', { lineHeight: 'var(--vscode-line-height-normal)' }],
        'vscode-base': ['var(--vscode-font-size-base)', { lineHeight: 'var(--vscode-line-height-normal)' }],
        'vscode-lg': ['var(--vscode-font-size-lg)', { lineHeight: 'var(--vscode-line-height-relaxed)' }],
        'vscode-xl': ['var(--vscode-font-size-xl)', { lineHeight: 'var(--vscode-line-height-relaxed)' }],
        'vscode-2xl': ['var(--vscode-font-size-2xl)', { lineHeight: 'var(--vscode-line-height-snug)' }],
        'vscode-3xl': ['var(--vscode-font-size-3xl)', { lineHeight: 'var(--vscode-line-height-snug)' }],
        'vscode-4xl': ['var(--vscode-font-size-4xl)', { lineHeight: 'var(--vscode-line-height-tight)' }],
        'vscode-h1': ['var(--vscode-font-size-h1)', { lineHeight: 'var(--vscode-line-height-h1)' }],
        'vscode-h2': ['var(--vscode-font-size-h2)', { lineHeight: 'var(--vscode-line-height-h2)' }],
        'vscode-h3': ['var(--vscode-font-size-h3)', { lineHeight: 'var(--vscode-line-height-h3)' }],
        'vscode-h4': ['var(--vscode-font-size-h4)', { lineHeight: 'var(--vscode-line-height-h4)' }],
        'vscode-h5': ['var(--vscode-font-size-h5)', { lineHeight: 'var(--vscode-line-height-h5)' }],
        'vscode-h6': ['var(--vscode-font-size-h6)', { lineHeight: 'var(--vscode-line-height-h6)' }],
      },
      
      // Typography - Font Weights
      fontWeight: {
        'vscode-normal': 'var(--vscode-font-weight-normal)',
        'vscode-medium': 'var(--vscode-font-weight-medium)',
        'vscode-semibold': 'var(--vscode-font-weight-semibold)',
        'vscode-bold': 'var(--vscode-font-weight-bold)',
      },
      
      // Typography - Line Heights
      lineHeight: {
        'vscode-tight': 'var(--vscode-line-height-tight)',
        'vscode-snug': 'var(--vscode-line-height-snug)',
        'vscode-normal': 'var(--vscode-line-height-normal)',
        'vscode-relaxed': 'var(--vscode-line-height-relaxed)',
        'vscode-loose': 'var(--vscode-line-height-loose)',
      },
      
      // Typography - Letter Spacing
      letterSpacing: {
        'vscode-tighter': 'var(--vscode-letter-spacing-tighter)',
        'vscode-tight': 'var(--vscode-letter-spacing-tight)',
        'vscode-normal': 'var(--vscode-letter-spacing-normal)',
        'vscode-wide': 'var(--vscode-letter-spacing-wide)',
        'vscode-wider': 'var(--vscode-letter-spacing-wider)',
      },
      
      // Spacing - Using Design Tokens
      spacing: {
        'vscode-0': 'var(--vscode-spacing-0)',
        'vscode-px': 'var(--vscode-spacing-px)',
        'vscode-0-5': 'var(--vscode-spacing-0-5)',
        'vscode-1': 'var(--vscode-spacing-1)',
        'vscode-1-5': 'var(--vscode-spacing-1-5)',
        'vscode-2': 'var(--vscode-spacing-2)',
        'vscode-2-5': 'var(--vscode-spacing-2-5)',
        'vscode-3': 'var(--vscode-spacing-3)',
        'vscode-3-5': 'var(--vscode-spacing-3-5)',
        'vscode-4': 'var(--vscode-spacing-4)',
        'vscode-5': 'var(--vscode-spacing-5)',
        'vscode-6': 'var(--vscode-spacing-6)',
        'vscode-7': 'var(--vscode-spacing-7)',
        'vscode-8': 'var(--vscode-spacing-8)',
        'vscode-9': 'var(--vscode-spacing-9)',
        'vscode-10': 'var(--vscode-spacing-10)',
        'vscode-11': 'var(--vscode-spacing-11)',
        'vscode-12': 'var(--vscode-spacing-12)',
        'vscode-14': 'var(--vscode-spacing-14)',
        'vscode-16': 'var(--vscode-spacing-16)',
        'vscode-20': 'var(--vscode-spacing-20)',
        'vscode-24': 'var(--vscode-spacing-24)',
        'vscode-28': 'var(--vscode-spacing-28)',
        'vscode-32': 'var(--vscode-spacing-32)',
        
        // Semantic spacing aliases
        'vscode-xs': 'var(--vscode-spacing-xs)',
        'vscode-sm': 'var(--vscode-spacing-sm)',
        'vscode-md': 'var(--vscode-spacing-md)',
        'vscode-lg': 'var(--vscode-spacing-lg)',
        'vscode-xl': 'var(--vscode-spacing-xl)',
        'vscode-2xl': 'var(--vscode-spacing-2xl)',
        
        // Legacy spacing values (kept for compatibility)
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
      
      // Border Radius - Using Design Tokens
      borderRadius: {
        'vscode-none': 'var(--vscode-radius-none)',
        'vscode-sm': 'var(--vscode-radius-sm)',
        'vscode-md': 'var(--vscode-radius-md)',
        'vscode-lg': 'var(--vscode-radius-lg)',
        'vscode-xl': 'var(--vscode-radius-xl)',
        'vscode-2xl': 'var(--vscode-radius-2xl)',
        'vscode-3xl': 'var(--vscode-radius-3xl)',
        'vscode-full': 'var(--vscode-radius-full)',
        
        // Legacy border radius values (kept for compatibility)
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
      
      // Box Shadow - Using Design Tokens
      boxShadow: {
        'vscode-xs': 'var(--vscode-shadow-xs)',
        'vscode-sm': 'var(--vscode-shadow-sm)',
        'vscode-md': 'var(--vscode-shadow-md)',
        'vscode-lg': 'var(--vscode-shadow-lg)',
        'vscode-xl': 'var(--vscode-shadow-xl)',
        'vscode-2xl': 'var(--vscode-shadow-2xl)',
        'vscode-inner': 'var(--vscode-shadow-inner)',
        'vscode-glow-sm': 'var(--vscode-shadow-glow-sm)',
        'vscode-glow-md': 'var(--vscode-shadow-glow-md)',
        'vscode-glow-lg': 'var(--vscode-shadow-glow-lg)',
      },
      
      // Animation Durations - Using Design Tokens
      transitionDuration: {
        'vscode-instant': 'var(--vscode-duration-instant)',
        'vscode-fast': 'var(--vscode-duration-fast)',
        'vscode-normal': 'var(--vscode-duration-normal)',
        'vscode-slow': 'var(--vscode-duration-slow)',
        'vscode-slower': 'var(--vscode-duration-slower)',
        
        // Legacy duration values (kept for compatibility)
        '0': '0ms',
        '150': '150ms',
        '200': '200ms',
        '250': '250ms',
        '300': '300ms',
        '350': '350ms',
        '400': '400ms',
        '500': '500ms',
      },
      
      // Animation Timing Functions - Using Design Tokens
      transitionTimingFunction: {
        'vscode-linear': 'var(--vscode-ease-linear)',
        'vscode-in': 'var(--vscode-ease-in)',
        'vscode-out': 'var(--vscode-ease-out)',
        'vscode-in-out': 'var(--vscode-ease-in-out)',
        'vscode-spring': 'var(--vscode-ease-spring)',
        'vscode-out-back': 'var(--vscode-ease-out-back)',
        'vscode-in-back': 'var(--vscode-ease-in-back)',
        
        // Legacy timing functions (kept for compatibility)
        'ease-in-out-back': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'ease-out-back': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'ease-in-back': 'cubic-bezier(0.6, -0.28, 0.735, 0.045)',
      },
      
      // Animation - Using Design Tokens
      animation: {
        'vscode-fade-in': 'var(--vscode-animate-fade-in)',
        'vscode-fade-out': 'var(--vscode-animate-fade-out)',
        'vscode-slide-in': 'var(--vscode-animate-slide-in)',
        'vscode-slide-out': 'var(--vscode-animate-slide-out)',
        'vscode-scale-in': 'var(--vscode-animate-scale-in)',
        'vscode-scale-out': 'var(--vscode-animate-scale-out)',
        
        // Legacy animations (kept for compatibility)
        'fade-in': 'var(--vscode-animate-fade-in, fadeIn 0.2s ease-in-out)',
        'fade-out': 'var(--vscode-animate-fade-out, fadeOut 0.2s ease-in-out)',
        'slide-in': 'var(--vscode-animate-slide-in, slideIn 0.2s ease-out)',
        'slide-out': 'var(--vscode-animate-slide-out, slideOut 0.2s ease-in)',
        'scale-in': 'var(--vscode-animate-scale-in, scaleIn 0.2s ease-out)',
        'scale-out': 'var(--vscode-animate-scale-out, scaleOut 0.2s ease-in)',
        'spin-slow': 'spin 3s linear infinite',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
      },
      
      // Transition Property Extensions
      transitionProperty: {
        'width': 'width',
        'height': 'height',
        'spacing': 'margin, padding',
        'size': 'width, height',
        'colors': 'color, background-color, border-color, text-decoration-color, fill, stroke',
        'opacity-transform': 'opacity, transform',
        'visibility-opacity': 'visibility, opacity',
      },
      
      // Layout - Width and Height
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
        'vscode-sidebar': 'var(--vscode-sidebar-width)',
        'vscode-sidebar-collapsed': 'var(--vscode-sidebar-width-collapsed)',
        'vscode-content': 'calc(100% - var(--vscode-sidebar-width))',
        'sidebar': '280px',
        'content': 'calc(100% - 280px)',
        'activity-bar': 'var(--activity-bar-width, 48px)',
        'panel': 'var(--panel-width, 400px)',
      },
      
      height: {
        'vscode-header': 'var(--vscode-header-height)',
        'sidebar': 'var(--sidebar-height, 100vh)',
        'panel': 'var(--panel-height, 300px)',
        'status-bar': 'var(--status-bar-height, 22px)',
        'activity-bar': 'var(--activity-bar-height, 100vh)',
      },
      
      maxWidth: {
        'vscode-content': 'var(--vscode-content-max-width)',
        'sidebar': 'var(--sidebar-max-width, 400px)',
        'panel': 'var(--panel-max-width, 600px)',
      },
      
      minWidth: {
        'vscode-sidebar': 'var(--vscode-sidebar-width-collapsed)',
        'sidebar': 'var(--sidebar-min-width, 200px)',
        'panel': 'var(--panel-min-width, 300px)',
      },
      
      minHeight: {
        'status-bar': 'var(--status-bar-height, 22px)',
        'panel': 'var(--panel-min-height, 150px)',
      },
      
      maxHeight: {
        'panel': 'var(--panel-max-height, 600px)',
      },
      
      // Padding Extensions
      padding: {
        'vscode-content-x': 'var(--vscode-content-padding-x)',
        'safe': 'env(safe-area-inset-bottom)',
      },
      
      // Z-index Scale - Using Design Tokens
      zIndex: {
        'vscode-dropdown': 'var(--vscode-z-dropdown)',
        'vscode-sticky': 'var(--vscode-z-sticky)',
        'vscode-fixed': 'var(--vscode-z-fixed)',
        'vscode-modal-backdrop': 'var(--vscode-z-modal-backdrop)',
        'vscode-modal': 'var(--vscode-z-modal)',
        'vscode-popover': 'var(--vscode-z-popover)',
        'vscode-tooltip': 'var(--vscode-z-tooltip)',
        'vscode-toast': 'var(--vscode-z-toast)',
        
        // Legacy z-index values (kept for compatibility)
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
