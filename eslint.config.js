import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// Allow intentionally-unused identifiers when prefixed with `_` (a common convention
			// for deliberately-ignored bindings, destructures, and caught errors).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	},
	// Test fixtures frequently cast partial entities to `any` (e.g. Dexie auto-increment
	// inserts where the id is generated). Allow `any` in tests only; production code keeps
	// @typescript-eslint/no-explicit-any on.
	{
		files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.svelte.ts', '**/*.svelte.test.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	// AC #3 guardrail: dexie must only be imported from within src/lib/db/**
	{
		files: ['src/**/*.{ts,js,svelte}'],
		ignores: ['src/lib/db/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: ['dexie'],
					patterns: ['dexie/*']
				}
			]
		}
	},
	// Generated shadcn-svelte primitives pass `href` through as an opaque prop (the caller resolves
	// the path), so svelte/no-navigation-without-resolve fires inside ui/button. Scope the rule off
	// the generated primitive layer instead of an inline eslint-disable that a shadcn regen would
	// silently drop. See docs/adr/004-generated-ui-primitive-edits.md.
	{
		files: ['src/lib/components/ui/**/*.svelte'],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
