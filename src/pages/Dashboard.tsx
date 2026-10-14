import { ArrowUpRight, CalendarClock, Layers3 } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { PageHeader } from "../components/PageHeader";
import { navigation } from "../app/navigation";

export function Dashboard() {
  return (
    <>
      <PageHeader
        title="حياتك الأكاديمية، تحت السيطرة."
        description="مساحة مركزة لفصلك الدراسي. مراجعة الجدول متاحة من المقررات؛ ربط لوحة التحكم بالبيانات مخطط لاحقاً."
      />
      <section className="welcome-panel">
        <div>
          <p className="eyebrow text-secondary">مصممة حول فصلك الدراسي</p>
          <h2>
            تشتت أقل.
            <br />
            تركيز أكبر.
          </h2>
          <p>
            المقررات والمحاضرات والمواد ستجتمع هنا. استكشف المساحات المخططة
            أثناء تطوير التطبيق.
          </p>
          <span className="badge">مساحة أكاديمية قيد التطوير</span>
        </div>
        <div className="welcome-symbol" aria-hidden="true">
          <Layers3 size={72} strokeWidth={1} />
        </div>
      </section>
      <div className="section-heading">
        <h2>مساحتك الأكاديمية</h2>
        <span>التنقل متاح · التكاملات مخططة</span>
      </div>
      <section className="workspace-grid" aria-label="مساحات العمل">
        {navigation
          .filter((item) => item.path !== "/")
          .map(({ path, label, icon: Icon }) => (
            <Link to={path} className="workspace-card" key={path}>
              <div className="card-top">
                <Icon size={24} aria-hidden="true" />
                <ArrowUpRight size={18} aria-hidden="true" />
              </div>
              <h3>{label}</h3>
              <p>استكشف مساحة {label}.</p>
              <span className="badge">مخطط</span>
            </Link>
          ))}
      </section>
      <section className="schedule-preview">
        <CalendarClock size={26} aria-hidden="true" />
        <div>
          <h2>عرض الجدول والعد التنازلي للمحاضرات</h2>
          <p>الربط بلوحة التحكم مخطط لاحقاً؛ لا يوجد عد تنازلي نشط.</p>
        </div>
        <time dateTime={format(new Date(), "yyyy-MM-dd")}>
          {format(new Date(), "EEE, d MMM yyyy")}
        </time>
      </section>
    </>
  );
}
