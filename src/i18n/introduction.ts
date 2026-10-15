import { dynamic, getLanguage } from "./locale";
const ar = {
  welcome: "مرحباً بك في UniCore",
  purpose:
    "نظّم فصولك ومقرراتك ومحاضراتك وملفاتك في مساحة أكاديمية واحدة، دون الحاجة إلى حساب أو ذكاء اصطناعي.",
  local:
    "الوضع المحلي: بياناتك مرتبطة بهذا المتصفح والموقع، دون نسخ احتياطي أو مزامنة تلقائية. تحميل التطبيق دون اتصال غير مضمون بعد.",
  tour: "جولة سريعة",
  skip: "تخطي الجولة",
  next: "التالي",
  choices: "كيف تريد البدء؟",
  import: "استيراد جدولي",
  manual: "إضافة المقررات يدوياً",
  later: "سأفعل ذلك لاحقاً",
  dashboard: "لوحة التحكم",
  dashboardInfo: "ملخص يومك، جلساتك القادمة وإحصاءات فصلك المحفوظ.",
  courses: "المقررات والتقويم",
  coursesInfo: "راجع مقرراتك وجلساتك الأسبوعية وتواريخك وعدّلها بأمان.",
  lectures: "المحاضرات",
  lecturesInfo: "أنشئ سجلات محاضراتك الفعلية واحفظ مرفقاتها محلياً.",
  materials: "المواد",
  materialsInfo:
    "تنظيم الموارد العامة للمقررات مخطط لمرحلة لاحقة؛ لا توجد واجهة مواد فعالة بعد.",
  settings: "الإعدادات",
  replay: "إعادة المقدمة",
  checking: "جارٍ التحقق من البيانات المحلية…",
  error:
    "تعذر التحقق من البيانات. لن نعتبر التخزين فارغاً. أعد المحاولة دون مسح بيانات الموقع.",
  retry: "إعادة المحاولة",
  continue: "فتح لوحة التحكم",
  newTerm: "إعداد فصل دراسي",
  termHint: "أدخل فصلَك الحقيقي لبدء إضافة مقرراتك. لا ننشئ بيانات نموذجية.",
  name: "اسم الفصل",
  year: "العام الدراسي",
  semester: "رقم الفصل",
  create: "حفظ الفصل وإضافة المقررات",
  cancel: "إلغاء",
  saveError: "تعذر حفظ الفصل. راجع الحقول أو التخزين ثم أعد المحاولة.",
  saved: "تم حفظ الجدول. يمكنك الآن متابعة يومك من لوحة التحكم.",
  unsupported:
    "استخراج الملفات والصور غير متاح بعد. يمكنك إدخال مسودة فارغة ومراجعتها الآن؛ دعم رفع الملفات واستخراجها مخطط للمرحلة B.",
  draftHint:
    "المسودة تبدأ فارغة. أدخل معلوماتك فقط؛ لن يُحفظ شيء دون المراجعة والتأكيد.",
  startSetup: "إعداد الفصل يدوياً",
  localOnly: "محلي فقط",
  language: "اللغة",
  progress: "الجولة التعريفية",
};
const en: typeof ar = {
  welcome: "Welcome to UniCore",
  purpose:
    "Organize terms, courses, lectures and files in one academic space, without needing an account or AI.",
  local:
    "Local mode: data belongs to this browser and origin, without automatic backup or synchronization. Offline application loading is not guaranteed yet.",
  tour: "Take a quick tour",
  skip: "Skip tour",
  next: "Next",
  choices: "How would you like to start?",
  import: "Import My Timetable",
  manual: "Add Courses Manually",
  later: "I'll Do This Later",
  dashboard: "Dashboard",
  dashboardInfo:
    "Your daily overview, upcoming sessions and saved-term statistics.",
  courses: "Courses & Calendar",
  coursesInfo:
    "Review and safely edit your courses, weekly sessions and dates.",
  lectures: "Lectures",
  lecturesInfo:
    "Create real lecture records and retain their attachments locally.",
  materials: "Materials",
  materialsInfo:
    "General course resource organization is planned for a later phase; materials management is not available yet.",
  settings: "Settings",
  replay: "Replay introduction",
  checking: "Checking local academic data…",
  error:
    "Could not inspect local data. Storage will not be assumed empty. Retry without clearing site data.",
  retry: "Retry",
  continue: "Open Dashboard",
  newTerm: "Set up an academic term",
  termHint:
    "Enter your real term to start adding courses. No sample data will be created.",
  name: "Term name",
  year: "Academic year",
  semester: "Semester number",
  create: "Save term and add courses",
  cancel: "Cancel",
  saveError: "Could not save the term. Review the fields or storage and retry.",
  saved: "Timetable saved. Continue your academic day from the Dashboard.",
  unsupported:
    "File/image extraction is not available yet. You can enter and review an empty draft now; file ingestion and extraction are planned for Phase B.",
  draftHint:
    "The draft starts empty. Enter only your own information; nothing is saved without review and confirmation.",
  startSetup: "Set up a term manually",
  localOnly: "Local Only",
  language: "Language",
  progress: "Introduction tour",
};
export const introductionText = dynamic(() =>
  getLanguage() === "ar" ? ar : en,
);
