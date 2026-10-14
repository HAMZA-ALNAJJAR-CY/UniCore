import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

export function NotFound() {
  return (
    <>
      <PageHeader
        title="Page not found"
        description="This address does not lead to a UniCore page."
      />
      <section className="empty-state">
        <Compass size={40} aria-hidden="true" />
        <h2>Let’s get you back on track.</h2>
        <p>The page may have moved, or the address may be incorrect.</p>
        <Link className="button-link" to="/">
          Back to dashboard
        </Link>
      </section>
    </>
  );
}
