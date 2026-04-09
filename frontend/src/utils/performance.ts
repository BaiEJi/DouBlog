/**
 * Performance Monitoring Utilities
 * Tracks Core Web Vitals and custom performance metrics
 */

interface PerformanceMetric {
  name: string
  value: number
  timestamp: number
}

interface PerformanceReport {
  metrics: PerformanceMetric[]
  bundleSize: {
    total: number
    chunks: Record<string, number>
  }
  timestamp: string
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []

  constructor() {
    this.initializeObservers()
  }

  private initializeObservers() {
    if (typeof window === 'undefined') return

    this.observeWebVitals()
    this.observeResourceTiming()
  }

  private observeWebVitals() {
    if (!('PerformanceObserver' in window)) return

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'measure') {
            this.recordMetric(entry.name, entry.duration)
          }
        }
      })
      observer.observe({ entryTypes: ['measure'] })
    } catch (e) {
      console.warn('PerformanceObserver not supported')
    }
  }

  private observeResourceTiming() {
    if (!('PerformanceObserver' in window)) return

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'resource') {
            const resourceEntry = entry as PerformanceResourceTiming
            if (resourceEntry.name.includes('/assets/')) {
              this.recordMetric(
                `resource_${this.extractChunkName(resourceEntry.name)}`,
                resourceEntry.duration
              )
            }
          }
        }
      })
      observer.observe({ entryTypes: ['resource'] })
    } catch (e) {
      console.warn('Resource timing observer not supported')
    }
  }

  private extractChunkName(url: string): string {
    const match = url.match(/\/assets\/([^-]+)-/)
    return match ? match[1] : 'unknown'
  }

  recordMetric(name: string, value: number) {
    this.metrics.push({
      name,
      value,
      timestamp: Date.now()
    })
  }

  measurePageLoad() {
    if (typeof window === 'undefined') return

    window.addEventListener('load', () => {
      setTimeout(() => {
        const timing = performance.timing
        const pageLoadTime = timing.loadEventEnd - timing.navigationStart
        const domReadyTime = timing.domContentLoadedEventEnd - timing.navigationStart
        const firstPaint = timing.responseEnd - timing.navigationStart

        this.recordMetric('page_load', pageLoadTime)
        this.recordMetric('dom_ready', domReadyTime)
        this.recordMetric('first_paint', firstPaint)

        if ('PerformanceObserver' in window) {
          try {
            const paintEntries = performance.getEntriesByType('paint')
            paintEntries.forEach((entry) => {
              this.recordMetric(entry.name, entry.startTime)
            })
          } catch (e) {
            console.warn('Paint timing not available')
          }
        }
      }, 0)
    })
  }

  measureChunkLoad(chunkName: string) {
    const start = performance.now()
    return () => {
      const duration = performance.now() - start
      this.recordMetric(`chunk_${chunkName}`, duration)
    }
  }

  getMetrics(): PerformanceMetric[] {
    return [...this.metrics]
  }

  getReport(): PerformanceReport {
    const chunks: Record<string, number> = {}
    
    if (typeof window !== 'undefined') {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      resources.forEach((resource) => {
        if (resource.name.includes('/assets/')) {
          const chunkName = this.extractChunkName(resource.name)
          chunks[chunkName] = (chunks[chunkName] || 0) + resource.transferSize || 0
        }
      })
    }

    return {
      metrics: this.getMetrics(),
      bundleSize: {
        total: Object.values(chunks).reduce((sum, size) => sum + size, 0),
        chunks
      },
      timestamp: new Date().toISOString()
    }
  }

  logReport() {
    const report = this.getReport()
    console.group('📊 Performance Report')
    console.log('Timestamp:', report.timestamp)
    console.log('\n📈 Metrics:')
    report.metrics.forEach(({ name, value }) => {
      console.log(`  ${name}: ${value.toFixed(2)}ms`)
    })
    console.log('\n📦 Bundle Size:')
    console.log(`  Total: ${(report.bundleSize.total / 1024).toFixed(2)}KB`)
    Object.entries(report.bundleSize.chunks).forEach(([name, size]) => {
      console.log(`  ${name}: ${(size / 1024).toFixed(2)}KB`)
    })
    console.groupEnd()
  }
}

export const performanceMonitor = new PerformanceMonitor()

export function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  return fn().finally(() => {
    const duration = performance.now() - start
    performanceMonitor.recordMetric(name, duration)
  })
}

export function withPerformanceTracking<T extends (...args: any[]) => any>(
  name: string,
  fn: T
): T {
  return ((...args: Parameters<T>) => {
    const start = performance.now()
    const result = fn(...args)
    const duration = performance.now() - start
    performanceMonitor.recordMetric(name, duration)
    return result
  }) as T
}
