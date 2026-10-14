import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

export function NotFound() {
  return (
    <>
      <PageHeader
        title="الصفحة غير موجودة"
        description="هذا العنوان لا يشير إلى صفحة في UniCore."
      />
      <section className="empty-state">
        <Compass size={40} aria-hidden="true" />
        <h2>لنعد إلى مساحتك الأكاديمية.</h2>
        <p>قد تكون الصفحة انتقلت أو أن العنوان غير صحيح.</p>
        <Link className="button-link" to="/">
          العودة إلى لوحة التحكم
        </Link>
      </section>
    </>
  );
}
