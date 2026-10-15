import { useContext, useEffect, useRef } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import { introductionText as t } from "../i18n/introduction";

/** Data-router guard also covers browser Back/Forward, which click handlers cannot intercept. */
type GuardProps = { enabled: boolean; onDiscard: () => void };

export function EditorNavigationGuard({ enabled, onDiscard }: GuardProps) {
  const context = useContext(UNSAFE_DataRouterContext);
  return context ? <BlockedNavigation enabled={enabled} onDiscard={onDiscard} /> : null;
}

function BlockedNavigation({ enabled, onDiscard }: GuardProps) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => enabled &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (blocker.state === "blocked") heading.current?.focus();
  }, [blocker.state]);
  if (blocker.state !== "blocked") return null;
  return <section className="review-card" role="region" aria-labelledby="blocked-navigation-title">
    <h2 id="blocked-navigation-title" tabIndex={-1} ref={heading}>{t.finishEditing}</h2>
    <div className="management-actions">
      <button onClick={() => {
        blocker.reset();
        document.querySelector<HTMLElement>(".management-editor h2")?.focus();
      }}>{t.keepEditing}</button>
      <button onClick={() => { onDiscard(); blocker.proceed(); }}>{t.discardAndLeave}</button>
    </div>
  </section>;
}
