module.exports = {
	ci: {
		collect: {
			staticDistDir: './build',
			url: ['http://localhost/'],
			numberOfRuns: 3,
			settings: {
				// Lighthouse 12 default: mobile form factor with simulated throttling
				// (4x CPU slowdown, ~1.6 Mbps throughput, 150ms RTT)
				chromeFlags: '--headless --no-sandbox --disable-gpu'
			}
		},
		assert: {
			assertions: {
				// Performance score: error below 85 (NFR target) — CI gate
				'categories:performance': ['error', { minScore: 0.85 }],
				// FCP: error if exceeds 2s (NFR1) — CI gate
				'first-contentful-paint': ['error', { maxNumericValue: 2000 }],
				// TTI: error if exceeds 3s (NFR2) — CI gate
				interactive: ['error', { maxNumericValue: 3000 }],
				// CLS: error if exceeds 0.1 (best practice) — CI gate
				'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }]
				// Note: Lighthouse 12 removed the PWA category entirely.
				// PWA capabilities are verified via artifact tests in precache-manifest.test.ts.
			}
		},
		upload: {
			target: 'temporary-public-storage'
		}
	}
};
