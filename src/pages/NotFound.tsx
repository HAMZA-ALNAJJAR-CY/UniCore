import { tr } from "../i18n/locale";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

export function NotFound() {
  return (
    <>
      <PageHeader title={tr("text_3")} description={tr("text_19")} />
      <section className="empty-state">
        <Compass size={40} aria-hidden="true" />
        <h2>{tr("text_20")}</h2>
        <p>{tr("text_21")}</p>
        <Link className="button-link" to="/">
          {tr("text_22")}
        </Link>
      </section>
    </>
  );
}
