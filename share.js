(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('share-dialog');
  const urlField = $('share-url');
  // Share the public game, including from local previews or URLs with room parameters.
  // assets/neon-qr.svg encodes this same canonical URL; update both if the game moves.
  const gameUrl = urlField.value;
  const shareButton = $('share-native');
  const installButton = $('share-install-button');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  let installed = false;

  const status = message => { $('share-status').textContent = message; };
  function updateInstall() {
    const isInstalled = installed || standalone.matches || navigator.standalone === true;
    $('share-installed').hidden = !isInstalled;
    $('share-install-help').hidden = isInstalled;
    installButton.hidden = isInstalled || !installPrompt;
  }

  $('share-open').addEventListener('click', () => {
    status('');
    updateInstall();
    dialog.showModal();
    dialog.scrollTop = 0;
  });
  $('share-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => $('share-open').focus());
  // A click on the backdrop closes the panel; clicking its own padding does not.
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  // Native <dialog> supplies Escape dismissal, focus containment and an inert menu.
  urlField.addEventListener('click', () => urlField.select());
  $('share-copy').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(gameUrl);
      status('Link copied. Bring a friend to the grid.');
    } catch (_) {
      urlField.focus();
      urlField.select();
      urlField.setSelectionRange(0, gameUrl.length);
      status('Link selected. Touch and hold to copy, or press Ctrl/Cmd+C.');
    }
  });

  shareButton.hidden = typeof navigator.share !== 'function';
  shareButton.addEventListener('click', async () => {
    shareButton.disabled = true;
    status('');
    try {
      await navigator.share({title:'Neon Trails', text:'Draw your escape. Play Neon Trails with me.', url:gameUrl});
    } catch (error) {
      if (error.name !== 'AbortError') status('Sharing is unavailable here. Use Copy link or scan the code.');
    } finally {
      shareButton.disabled = false;
    }
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstall();
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.disabled = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      status(choice.outcome === 'accepted' ? 'Follow your browser to finish adding the game.' : 'You can add the game later from your browser menu.');
    } catch (_) {
      status('Use the instructions below to add the game from your browser menu.');
      $('share-install-help').open = true;
    } finally {
      installButton.disabled = false;
      updateInstall();
    }
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    updateInstall();
    status('Neon Trails added. Your next game is one tap away.');
  });
  standalone.addEventListener?.('change', updateInstall);
  updateInstall();
})();
