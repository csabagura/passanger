<script lang="ts">
	import ImportWizard from '$lib/components/ImportWizard.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.import_page_title()} | passanger</title>
</svelte:head>

<div class="px-4 pt-4">
	<header class="space-y-1">
		<p class="text-sm text-muted-foreground">
			{m.import_page_intro()}
		</p>
	</header>

	<div class="mt-6">
		<ImportWizard />
	</div>
</div>
