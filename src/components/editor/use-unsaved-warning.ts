"use client";

import { useEffect } from "react";

export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function followLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.download || (link.target && link.target !== "_self")) return;
      const target = new URL(link.href);
      // External navigation is covered by beforeunload. Include the global header links.
      if (target.origin !== location.origin || target.pathname + target.search === location.pathname + location.search) return;
      if (!window.confirm("You have unsaved changes. Leave this document and discard them?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", followLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", followLink, true);
    };
  }, [dirty]);
}
