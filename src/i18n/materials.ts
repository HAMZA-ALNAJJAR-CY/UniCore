import { dynamic, getLanguage } from "./locale";

const en = {
  title: "Academic materials", intro: "Organize local resources by academic term and course.",
  local: "Files stay on this device. They are not backed up or synced. Downloads do not scan files for malware; open trusted files only.",
  term: "Academic term", course: "Course", allCourses: "All courses", search: "Search materials", category: "Category", allCategories: "All categories", uncategorized: "Uncategorized",
  create: "Create material", edit: "Edit material", open: "Open material", titleField: "Material title", description: "Description", optionalCategory: "Category (optional)",
  save: "Save material", saving: "Saving…", saved: "Saved locally.", cancel: "Close editor", discard: "Discard draft", confirmDiscard: "Discard these unsaved changes?", keep: "Keep editing",
  loading: "Loading materials…", refresh: "Refresh data", retry: "Retry", empty: "No materials in this term yet.", noResults: "No materials match these filters.",
  noCourses: "Add a course in this term before creating materials.", noTerms: "Create an academic term and course first.", courses: "Open Courses",
  files: "Files", picker: "Choose files", policy: "Up to 100 MiB per file. Supported documents, images, audio and video; download only.", noFiles: "No files attached. Materials can be saved without files.", selected: "Files to save", removeSelected: "Remove selected file", download: "Download file", removeFile: "Remove file", remove: "Remove material", confirm: "Confirm removal",
  removeWarning: "Remove this material and its active files from the library? Records and file bytes remain as deletion history; storage is not freed.",
  fileWarning: "Remove this file from the material? Its bytes remain as deletion history; storage is not freed.", count: "Active files included", pending: "Finish the pending operation before leaving.", changed: "Save or explicitly discard your draft before managing saved files.",
  invalidCourse: "The requested course is unavailable in this term. Choose an available course filter.",
  unsupported: "Unsupported or unsafe file name/extension.", mime: "The declared file type does not match its extension.", size: "File exceeds the 100 MiB limit.", emptyFile: "Empty files cannot be attached.",
  error: "Local storage could not complete the operation. Retry without resetting data.", conflict: "This record or its relationships changed. Your draft is retained. Close and reopen to review the latest version before retrying.", invalid: "Check the required fields and file policy. Nothing was saved.", missing: "This material or its academic parent is unavailable or deleted.", quota: "Device storage is full. Nothing was saved; your draft is retained.", downloadError: "Download could not start. Try again.",
  metadata: "File type · size", backCourse: "Back to course", results: "Materials found",
};
const ar: typeof en = {
  title: "المواد الأكاديمية", intro: "نظّم مواردك المحلية حسب الفصل والمقرر.",
  local: "تبقى الملفات على هذا الجهاز دون نسخ احتياطي أو مزامنة. التنزيل لا يفحص البرمجيات الضارة؛ افتح الملفات الموثوقة فقط.",
  term: "الفصل الدراسي", course: "المقرر", allCourses: "جميع المقررات", search: "البحث في المواد", category: "التصنيف", allCategories: "جميع التصنيفات", uncategorized: "دون تصنيف",
  create: "إنشاء مادة", edit: "تعديل المادة", open: "فتح المادة", titleField: "عنوان المادة", description: "الوصف", optionalCategory: "التصنيف (اختياري)",
  save: "حفظ المادة", saving: "جارٍ الحفظ…", saved: "حُفظت محلياً.", cancel: "إغلاق المحرر", discard: "تجاهل المسودة", confirmDiscard: "هل تريد تجاهل هذه التعديلات غير المحفوظة؟", keep: "متابعة التحرير",
  loading: "جارٍ تحميل المواد…", refresh: "تحديث البيانات", retry: "إعادة المحاولة", empty: "لا توجد مواد في هذا الفصل بعد.", noResults: "لا توجد مواد تطابق المرشحات.",
  noCourses: "أضف مقرراً في هذا الفصل قبل إنشاء المواد.", noTerms: "أنشئ فصلاً دراسياً ومقرراً أولاً.", courses: "فتح المقررات",
  files: "الملفات", picker: "اختيار ملفات", policy: "حتى 100 ميبيبايت لكل ملف. مستندات وصور وصوت وفيديو مدعومة؛ للتنزيل فقط.", noFiles: "لا توجد ملفات مرفقة. يمكن حفظ المادة دون ملفات.", selected: "ملفات للحفظ", removeSelected: "إزالة الملف المحدد", download: "تنزيل الملف", removeFile: "إزالة الملف", remove: "إزالة المادة", confirm: "تأكيد الإزالة",
  removeWarning: "إزالة المادة وملفاتها النشطة من المكتبة؟ تبقى السجلات والملفات كسجل حذف ولا تتحرر مساحة التخزين.",
  fileWarning: "إزالة الملف من المادة؟ تبقى بياناته كسجل حذف ولا تتحرر مساحة التخزين.", count: "الملفات النشطة المشمولة", pending: "أكمل العملية الجارية قبل المغادرة.", changed: "احفظ المسودة أو تجاهلها صراحةً قبل إدارة الملفات المحفوظة.",
  invalidCourse: "المقرر المطلوب غير متاح في هذا الفصل. اختر مقرراً متاحاً للترشيح.",
  unsupported: "اسم الملف أو امتداده غير مدعوم أو غير آمن.", mime: "نوع الملف المعلن لا يطابق امتداده.", size: "يتجاوز الملف حد 100 ميبيبايت.", emptyFile: "لا يمكن إرفاق ملفات فارغة.",
  error: "تعذر إكمال العملية في التخزين المحلي. أعد المحاولة دون إعادة ضبط البيانات.", conflict: "تغيّر السجل أو ارتباطاته. المسودة محفوظة في المحرر؛ أغلقه وأعد فتحه لمراجعة آخر نسخة قبل المحاولة.", invalid: "تحقق من الحقول المطلوبة وسياسة الملفات. لم يُحفظ شيء.", missing: "المادة أو المقرر أو الفصل غير متاح أو محذوف.", quota: "مساحة الجهاز ممتلئة. لم يُحفظ شيء وتبقى المسودة في المحرر.", downloadError: "تعذر بدء التنزيل. أعد المحاولة.",
  metadata: "نوع الملف · الحجم", backCourse: "العودة إلى المقرر", results: "المواد المطابقة",
};
export const materialsText = dynamic(() => getLanguage() === "ar" ? ar : en);
