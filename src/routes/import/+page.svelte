<script lang="ts">
	import ImportWizard from '$lib/components/ImportWizard.svelte';
</script>

<svelte:head>
	<title>Import | passanger</title>
</svelte:head>

<div class="px-4 pt-4">
	<header class="space-y-1">
		<p class="text-sm text-muted-foreground">
			Import fuel and maintenance history from another app.
		</p>
	</header>

	<div class="mt-6">
		<ImportWizard />
	</div>
</div>
