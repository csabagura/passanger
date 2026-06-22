<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { cn } from '$lib/utils.js';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	interface Props extends Omit<HTMLInputAttributes, 'id' | 'type' | 'files'> {
		/** Visible label cap shown above the input. */
		label: string;
		/** Two-way bound input value. */
		value?: string | number;
		/** Optional explicit id; a stable unique id is generated when omitted. */
		id?: string;
		/** Inline error message; when set, the input goes aria-invalid and is described by it. */
		error?: string;
		type?: InputType;
		class?: string;
	}

	let {
		label,
		value = $bindable(),
		id,
		error,
		type,
		class: className,
		'aria-describedby': ariaDescribedby,
		...rest
	}: Props = $props();

	// $props.id() gives a stable per-instance id so multiple Fields on a page never collide.
	const uid = $props.id();
	const inputId = $derived(id ?? `field-${uid}`);
	const errorId = $derived(`${inputId}-error`);
	// Merge any caller-supplied describedby (e.g. a hint) with the error region so both are announced.
	const describedBy = $derived(
		[ariaDescribedby, error ? errorId : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="flex flex-col gap-2">
	<Label for={inputId} class="text-label text-muted-foreground uppercase">{label}</Label>
	<Input
		{...rest}
		{type}
		id={inputId}
		bind:value
		aria-invalid={error ? true : undefined}
		aria-describedby={describedBy}
		class={cn('h-13 rounded-md md:text-base', className)}
	/>
	{#if error}
		<p id={errorId} role="alert" class="text-meta text-destructive">{error}</p>
	{/if}
</div>
