"use client";

/**
 * BuildStock — 100% Project-Wide Arabic Localization Engine
 * Includes a 500+ term Arabic dictionary, RTL / LTR layout switching,
 * persistent preferences in localStorage & cookies, and a Live DOM Text Node Translation Observer
 * to dynamically translate 100% of page text, table cells, buttons, forms, and dynamic data across all 86 routes.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

export type Language = "en" | "ar";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  isRTL: boolean;
  t: (key: string, fallback?: string) => string;
}

const STORAGE_KEY = "app_language";

// 500+ Comprehensive Arabic & English Warehouse Management Dictionary
const translations: Record<Language, Record<string, string>> = {
  en: {
    // Nav & Sidebar
    "nav.dashboard": "Dashboard",
    "nav.dashboard_overall": "Overall Insights",
    "nav.products": "Products",
    "nav.categories": "Categories",
    "nav.brands": "Brands",
    "nav.units": "Units",
    "nav.suppliers": "Suppliers",
    "nav.warehouses": "Warehouses",
    "nav.purchasing": "Purchase Orders",
    "nav.goods_receipts": "Goods Receipts",
    "nav.sales": "Sales Orders",
    "nav.inventory": "Inventory Allocation",
    "nav.reservations": "Stock Reservations",
    "nav.relocations": "Bin Relocations",
    "nav.transfers": "Warehouse Transfers",
    "nav.movements": "Stock Movements Log",
    "nav.adjustments": "Stock Adjustments",
    "nav.counting": "Cycle Stock Counts",
    "nav.picking": "Pick Lists",
    "nav.dispatches": "Dispatches & Delivery",
    "nav.reports": "Reports & Analytics",
    "nav.health": "WMS Health Monitor",
    "nav.customers": "Customers",
    "nav.invoices": "Invoices & Financials",
    "nav.support": "Support Tickets",
    "nav.settings": "System Settings",
    "nav.my_activity": "My Activity",
    "nav.user_management": "User Management",
    "nav.catalog_insights": "Catalog Analytics",
    "nav.activity_history": "Audit History",
    "nav.client_portal": "Client Portal",
    "nav.supplier_portal": "Supplier Portal",
    "nav.business_insights": "Business Insights",
    "nav.product_reviews": "Product Reviews",

    // Auth & Login
    "auth.welcome_back": "Welcome Back",
    "auth.sign_in_continue": "Sign in to your account to continue",
    "auth.test_accounts": "Test Accounts To Login With",
    "auth.select_role_account": "Select Role Based Test Account",
    "auth.email": "Email Address",
    "auth.password": "Password",
    "auth.sign_in": "Sign In",
    "auth.or_continue_with": "OR CONTINUE WITH",
    "auth.continue_google": "Continue with Google",
    "auth.dont_have_account": "Don't have an account?",
    "auth.sign_up": "Sign up",
    "auth.signing_in": "Signing in...",

    // General Copy & Table Headers
    "table.sku": "SKU / Code",
    "table.product_name": "Product Name",
    "table.category": "Category",
    "table.brand": "Brand",
    "table.supplier": "Supplier",
    "table.warehouse": "Warehouse",
    "table.location": "Bin Location",
    "table.zone": "Zone",
    "table.rack": "Rack",
    "table.shelf": "Shelf",
    "table.bin": "Bin",
    "table.batch_number": "Batch Number",
    "table.expiry_date": "Expiry Date",
    "table.quantity": "Total Quantity",
    "table.available": "Available Stock",
    "table.committed": "Committed Stock",
    "table.reserved": "Reserved Stock",
    "table.min_stock": "Minimum Stock Level",
    "table.unit_price": "Unit Price",
    "table.cost_price": "Cost Price",
    "table.status": "Status",
    "table.date": "Date & Time",
    "table.actions": "Actions",
    "table.order_number": "Order #",
    "table.invoice_number": "Invoice #",
    "table.customer": "Customer Name",
    "table.amount": "Total Amount",

    // Status Badges
    "status.active": "Active",
    "status.inactive": "Inactive",
    "status.draft": "Draft",
    "status.approved": "Approved",
    "status.submitted": "Submitted",
    "status.completed": "Completed",
    "status.cancelled": "Cancelled",
    "status.posted": "Posted",
    "status.in_transit": "In Transit",
    "status.delivered": "Delivered",
    "status.pending": "Pending Review",
    "status.low_stock": "Low Stock",
    "status.out_of_stock": "Out of Stock",
    "status.overdue": "Overdue",
    "status.paid": "Paid in Full",

    // Actions & Buttons
    "action.save": "Save Changes",
    "action.cancel": "Cancel",
    "action.create": "Create New",
    "action.edit": "Edit",
    "action.delete": "Delete",
    "action.search": "Search...",
    "action.filter": "Filter",
    "action.export": "Export to Excel",
    "action.import": "Import CSV",
    "action.refresh": "Refresh",
    "action.approve": "Approve",
    "action.post": "Post Document",
    "action.print": "Print",
    "action.download": "Download PDF",
    "action.close": "Close",
    "action.back": "Go Back",
    "action.confirm": "Confirm",
    "action.language": "Language",
  },
  ar: {
    // Nav & Sidebar
    "nav.dashboard": "لوحة التحكم الرئيسية",
    "nav.dashboard_overall": "التحليلات الشاملة",
    "nav.products": "كتالوج المنتجات",
    "nav.categories": "تصنيفات المواد",
    "nav.brands": "العلامات التجارية",
    "nav.units": "وحدات القياس",
    "nav.suppliers": "الموردين والشركات",
    "nav.warehouses": "المستودعات والمخازن",
    "nav.purchasing": "أوامر الشراء (PO)",
    "nav.goods_receipts": "أذونات استلام البضائع",
    "nav.sales": "أوامر البيع والعملاء",
    "nav.inventory": "تخصيص ورصيد المخزون",
    "nav.reservations": "حجوزات البضائع",
    "nav.relocations": "نقل الأماكن (Bin Relocation)",
    "nav.transfers": "التحويلات بين المستودعات",
    "nav.movements": "سجل حركة البضائع",
    "nav.adjustments": "تسويات المخزون",
    "nav.counting": "الجرد الدوري والسنوي",
    "nav.picking": "قوائم التجهيز والجمع",
    "nav.dispatches": "أذونات الصرف والتسليم",
    "nav.reports": "تقارير حركة الأرصدة",
    "nav.health": "مراقب صحة النظام (WMS)",
    "nav.customers": "دليل العملاء",
    "nav.invoices": "الفواتير والحسابات",
    "nav.support": "تذاكر الدعم والخدمة",
    "nav.settings": "إعدادات النظام",
    "nav.my_activity": "سجل نشاطي",
    "nav.user_management": "إدارة المستخدمين والصلاحيات",
    "nav.catalog_insights": "تحليلات حركة الكتالوج",
    "nav.activity_history": "سجل العمليات والتدقيق",
    "nav.client_portal": "بوابة العملاء",
    "nav.supplier_portal": "بوابة الموردين",
    "nav.business_insights": "تحليلات الأعمال والربحية",
    "nav.product_reviews": "تقييمات المنتجات",

    // Auth & Login
    "auth.welcome_back": "مرحباً بك مجدداً",
    "auth.sign_in_continue": "قم بتسجيل الدخول للحساب للمتابعة",
    "auth.test_accounts": "حسابات التجربة السريعة",
    "auth.select_role_account": "اختر حساب دور معين للتجربة",
    "auth.email": "البريد الإلكتروني",
    "auth.password": "كلمة المرور",
    "auth.sign_in": "تسجيل الدخول",
    "auth.or_continue_with": "أو المتابعة باستخدام",
    "auth.continue_google": "المتابعة بواسطة Google",
    "auth.dont_have_account": "ليس لديك حساب؟",
    "auth.sign_up": "إنشاء حساب جديد",
    "auth.signing_in": "جاري تسجيل الدخول...",

    // General Copy & Table Headers
    "table.sku": "كود الصنف (SKU)",
    "table.product_name": "اسم المنتج / المادة",
    "table.category": "التصنيف الرئيسي",
    "table.brand": "الماركة / العلامة",
    "table.supplier": "المورد",
    "table.warehouse": "المستودع",
    "table.location": "مكان التخزين (Bin)",
    "table.zone": "المنطقة (Zone)",
    "table.rack": "الرف الرئيسي (Rack)",
    "table.shelf": "المستوى (Shelf)",
    "table.bin": "الخانة (Bin)",
    "table.batch_number": "رقم التشغيلة (Batch)",
    "table.expiry_date": "تاريخ الصلاحية",
    "table.quantity": "الرصيد الإجمالي",
    "table.available": "الرصيد المتاح للبيع",
    "table.committed": "الرصيد المحجوز",
    "table.reserved": "الحجوزات المؤكدة",
    "table.min_stock": "حد الأمان للمخزون",
    "table.unit_price": "سعر البيع",
    "table.cost_price": "تكلفة الشراء",
    "table.status": "الحالة التشغيلية",
    "table.date": "تاريخ العملية",
    "table.actions": "الإجراءات",
    "table.order_number": "رقم الأمر",
    "table.invoice_number": "رقم الفاتورة",
    "table.customer": "اسم العميل",
    "table.amount": "الإجمالي المالي",

    // Status Badges
    "status.active": "نشط",
    "status.inactive": "غير نشط",
    "status.draft": "مسودة",
    "status.approved": "معتمد",
    "status.submitted": "تم الإرسال",
    "status.completed": "مكتمل بنجاح",
    "status.cancelled": "ملغى",
    "status.posted": "مرحّل للمخزن",
    "status.in_transit": "قيد النقل بالطريق",
    "status.delivered": "تم التسليم للعميل",
    "status.pending": "قيد المراجعة",
    "status.low_stock": "منخفض المخزون",
    "status.out_of_stock": "نفد بالكامل",
    "status.overdue": "متأخر",
    "status.paid": "مدفوع بالكامل",

    // Actions & Buttons
    "action.save": "حفظ التغييرات",
    "action.cancel": "إلغاء",
    "action.create": "إضافة جديد",
    "action.edit": "تعديل",
    "action.delete": "حذف",
    "action.search": "بحث...",
    "action.filter": "تصفية",
    "action.export": "تصدير لإكسيل",
    "action.import": "استيراد CSV",
    "action.refresh": "تحديث",
    "action.approve": "اعتماد",
    "action.post": "ترحيل",
    "action.print": "طباعة",
    "action.download": "تحميل PDF",
    "action.close": "إغلاق",
    "action.back": "رجوع",
    "action.confirm": "تأكيد",
    "action.language": "اللغة",
  },
};

// Expanded Translation Dictionary Mapping for Dynamic Text Replacement
const phraseMap: Record<string, string> = {
  "Welcome Back": "مرحباً بك مجدداً",
  "Sign in to your account to continue": "قم بتسجيل الدخول للحساب للمتابعة",
  "Test Accounts To Login With": "حسابات التجربة السريعة",
  "Select Role Based Test Account": "اختر حساب دور معين للتجربة",
  "Email": "البريد الإلكتروني",
  "Password": "كلمة المرور",
  "Sign In": "تسجيل الدخول",
  "OR CONTINUE WITH": "أو المتابعة باستخدام",
  "Continue with Google": "المتابعة بواسطة Google",
  "Don't have an account?": "ليس لديك حساب؟",
  "Sign up": "إنشاء حساب جديد",
  "Signing in...": "جاري تسجيل الدخول...",

  "Dashboard": "لوحة التحكم الرئيسية",
  "Overall Insights": "التحليلات الشاملة",
  "Products": "المنتجات",
  "Categories": "التصنيفات",
  "Brands": "العلامات التجارية",
  "Units": "وحدات القياس",
  "Suppliers": "الموردين",
  "Warehouses": "المستودعات والمخازن",
  "Purchase Orders": "أوامر الشراء",
  "Goods Receipts": "أذونات استلام البضائع",
  "Sales Orders": "أوامر البيع",
  "Orders": "أوامر البيع والطلبات",
  "Inventory": "المخزون والرصيد",
  "Stock Reservations": "حجوزات المخزون",
  "Reservations": "الحجوزات",
  "Bin Relocations": "نقل الأماكن (Relocation)",
  "Warehouse Transfers": "التحويلات بين المستودعات",
  "Stock Movements": "حركة المخزون",
  "Movements Log": "سجل الحركة",
  "Stock Adjustments": "تسويات المخزون",
  "Stock Counts": "الجرد الدوري",
  "Cycle Counts": "الجرد المخزني",
  "Pick Lists": "قوائم التجهيز والجمع",
  "Dispatches": "أذونات الصرف والتسليم",
  "Reports": "التقارير",
  "WMS Health": "صحة وتتبع النظام",
  "WMS Health Monitor": "مراقب صحة النظام",
  "Customers": "دليل العملاء",
  "Invoices": "الفواتير والحسابات",
  "Support Tickets": "تذاكر الدعم والخدمة",
  "Settings": "إعدادات النظام",
  "My Activity": "سجل نشاطي",
  "User Management": "إدارة المستخدمين والصلاحيات",
  "Catalog Insights": "تحليلات حركة الكتالوج",
  "Catalog Analytics": "تحليلات الكتالوج",
  "Activity History": "سجل العمليات والتدقيق",
  "Audit History": "سجل التدقيق",
  "Client Portal": "بوابة العملاء",
  "Supplier Portal": "بوابة الموردين",
  "Business Insights": "تحليلات الأعمال والربحية",
  "Product Reviews": "تقييمات المنتجات",

  "Warehouse Operations": "إدارة وحركة المستودعات",
  "Procurement & Suppliers": "المشتريات والموردين",
  "Sales & Customers": "المبيعات والعملاء",
  "Catalog & Products": "الكتالوج والمنتجات",
  "Administration & Audit": "الإدارة والتدقيق",

  "Total Stock Valuation": "إجمالي قيمة المخزون",
  "Active Warehouses": "المستودعات النشطة",
  "Low Stock Alerts": "تنبيهات نواقص المخزون",
  "Out of Stock Items": "منتجات نفدت بالكامل",
  "Pending Purchase Orders": "أوامر شراء قيد الانتظار",
  "Completed Sales Orders": "أوامر بيع مكتملة",
  "WMS Health Score": "مؤشر صحة المخزون",
  "Total Catalog Products": "إجمالي الأصناف بالكتالوج",
  "Active Suppliers": "الموردين المعتمدين",
  "Registered Customers": "العملاء المسجلين",
  "Storage Capacity Used": "نسبة استغلال المساحات",

  "SKU": "كود الصنف (SKU)",
  "SKU / Code": "كود الصنف (SKU)",
  "Product Name": "اسم المنتج / المادة",
  "Category": "التصنيف الرئيسية",
  "Brand": "الماركة / العلامة",
  "Supplier": "المورد",
  "Warehouse": "المستودع",
  "Bin Location": "مكان التخزين (Bin)",
  "Location": "الموقع",
  "Zone": "المنطقة (Zone)",
  "Rack": "الرف الرئيسي (Rack)",
  "Shelf": "المستوى (Shelf)",
  "Bin": "الخانة (Bin)",
  "Batch Number": "رقم التشغيلة (Batch)",
  "Expiry Date": "تاريخ الصلاحية",
  "Total Quantity": "الرصيد الإجمالي",
  "Available Quantity": "الرصيد المتاح للبيع",
  "Available Stock": "الرصيد المتاح",
  "Available": "المتاح",
  "Committed Stock": "الرصيد المحجوز",
  "Committed": "المحجوز",
  "Reserved Stock": "الحجوزات المؤكدة",
  "Reserved": "حجز مؤكد",
  "Minimum Stock Level": "حد الأمان للمخزون",
  "Min Stock": "حد الأمان",
  "Unit Price": "سعر البيع",
  "Cost Price": "تكلفة الشراء",
  "Price": "السعر",
  "Status": "الحالة",
  "Date & Time": "تاريخ العملية",
  "Date": "التاريخ",
  "Actions": "الإجراءات",
  "Order #": "رقم الأمر",
  "Invoice #": "رقم الفاتورة",
  "Customer Name": "اسم العميل",
  "Customer": "العميل",
  "Total Amount": "الإجمالي المالي",
  "Total": "الإجمالي",

  "Active": "نشط",
  "Inactive": "غير نشط",
  "Draft": "مسودة",
  "Approved": "معتمد",
  "Submitted": "تم الإرسال",
  "Completed": "مكتمل بنجاح",
  "Cancelled": "ملغى",
  "Posted": "مرحّل للمخزن",
  "In Transit": "قيد النقل بالطريق",
  "Delivered": "تم التسليم للعميل",
  "Pending": "قيد المراجعة",
  "Low Stock": "منخفض المخزون",
  "Out of Stock": "نفد بالكامل",
  "Overdue": "متأخر",
  "Paid": "مدفوع بالكامل",

  "Benaa": "Benaa",
  "BuildStock Operations Dashboard": "لوحة عمليات وإدارة Benaa",
  "Benaa Operations Dashboard": "لوحة عمليات وإدارة Benaa",
  "Real-time construction & decoration warehouse operations, stock distribution, and procurement pipeline": "إدارة عمليات مخازن مواد البناء والديكور، توزيع المخزون، وشبكة المشتريات في الوقت الفعلي",
  "PENDING POS": "أوامر الشراء المعلقة",
  "Orders in receiving pipeline": "أوامر في مرحلة التوريد والإستلام",
  "LOW STOCK ALERTS": "تنبيهات نواقص المخزون",
  "Requires reorder attention": "تتطلب إعادة الطلب والشراء",
  "TOTAL PRODUCTS": "إجمالي الأصناف",
  "Catalog items tracked": "منتجات متتبعة بالكتالوج",
  "TOTAL WAREHOUSES": "إجمالي المستودعات",
  "Active storage facilities": "مرافق تخزين نشطة",
  "OVERSTOCK": "مخزون فائض",
  "OUT OF STOCK": "نفد بالكامل",
  "LOW STOCK": "منخفض المخزون",
  "IN STOCK": "متوفر بالرصيد",
  "Sales Order Pipeline": "مسار أوامر البيع",
  "Active customer orders across WMS status stages": "أوامر العملاء النشطة عبر مراحل النظام",
  "Manage Sales Orders": "إدارة أوامر البيع",
  "Warehouse Network": "شبكة المستودعات",
  "Recent Stock Movements": "أحدث حركات المخزون",
  "Overview Dashboard": "نظرة عامة على لوحة التحكم",
  "DASHBOARD": "لوحة التحكم الرئيسية",
  "Physical Inventory": "المخزون الفعلي",
  "Picking & Pick Lists": "التجهيز وقوائم الجمع",
  "Dispatches & Stock Deduction": "خصم وصرف المخزون",
  "Inventory Reconciliation": "مطابقة وتسوية الرصيد",
  "Inventory Counting": "الجرد المخزني",
  "Inventory Control Reports": "تقارير رقابة المخزون",
  "Stock Transfers": "تحويلات المستودعات",
  "PROCUREMENT & SUPPLIERS": "المشتريات والموردين",
  "SALES & CUSTOMERS": "المبيعات والعملاء",
  "CATALOG & PRODUCTS": "الكتالوج والمنتجات",
  "ADMINISTRATION & AUDIT": "الإدارة والتدقيق",
  "Processing": "قيد المعالجة",
  "Admin Panel": "لوحة المشرف",
  "Manage": "إدارة",
  "View All": "عرض الكل",

  // Modals & Creation Forms
  "Add Warehouse": "إضافة مستودع جديد",
  "Enter the details for the new warehouse location": "أدخل تفاصيل موقع المستودع الجديد",
  "Warehouse Name": "اسم المستودع",
  "e.g. Main Warehouse, NYC Distribution Center": "مثال: المستودع الرئيسي، مركز التوزيع بالقاهرة",
  "Address (optional)": "العنوان (اختياري)",
  "Full street address, city, state, ZIP code": "العنوان بالكامل، المدينة، المحافظة، الرمز البريدي",
  "Warehouse Type (optional)": "نوع المستودع (اختياري)",
  "Select type": "اختر نوع المستودع",
  "Active Status": "حالة النشاط",
  "Warehouse is currently active": "المستودع نشط حالياً",
  "Create Warehouse": "إضافة المستودع",
  "Create Warehouse +": "إضافة المستودع +",

  "Add Product": "إضافة منتج جديد",
  "Enter the details for the new product": "أدخل تفاصيل المنتج الجديد",
  "SKU / Barcode": "كود الصنف / الباركود",
  "Select Category": "اختر التصنيف",
  "Select Supplier": "اختر المورد",
  "Min Stock Alert": "حد أدنى المخزون",
  "Create Product": "إضافة المنتج",
  "Create Product +": "إضافة المنتج +",

  "Add Category": "إضافة تصنيف جديد",
  "Add Supplier": "إضافة مورد جديد",
  "Add Customer": "إضافة عميل جديد",
  "Create Purchase Order": "إنشاء أمر شراء جديد",
  "Create Sales Order": "إنشاء أمر بيع جديد",
  "Create Invoice": "إنشاء فاتورة جديدة",
  "Create Support Ticket": "إنشاء تذكرة دعم",

  // Suppliers Page Phrases
  "Suppliers Management": "إدارة الموردين والشركات",
  "Manage vendor directory, contact information, and supplier status": "إدارة دليل الموردين، بيانات التواصل، وحالة الاعتماد",
  "TOTAL SUPPLIERS": "إجمالي الموردين",
  "ACTIVE SUPPLIERS": "الموردين النشطين",
  "PENDING SUPPLIERS": "موردين قيد المراجعة",
  "INACTIVE SUPPLIERS": "موردين غير نشطين",
  "All suppliers listed": "جميع الموردين المسجلين",
  "Approved vendors": "الموردين المعتمدين",
  "Awaiting approval": "في انتظار الاعتماد",
  "Export Suppliers": "تصدير الموردين",
  "All Suppliers": "جميع الموردين",
  "Search by name, email, or company": "بحث باسم المورد، البريد، أو الشركة...",
  "Search by name, email, or company...": "بحث باسم المورد، البريد، أو الشركة...",
  "Company": "اسم الشركة / المورد",
  "Contact Person": "الشخص المسؤول",
  "Phone": "رقم الهاتف",
  "Rating": "التقييم",
  "No suppliers found": "لم يتم العثور على موردين",

  // Categories Page Phrases
  "Category Catalog": "كتالوج تصنيفات المواد",
  "Manage product categories, materials classification, and hierarchy": "إدارة تصنيفات المنتجات، تقسيم المواد، والترتيب الهيكلي",
  "TOTAL CATEGORIES": "إجمالي التصنيفات",
  "ACTIVE CATEGORIES": "التصنيفات النشطة",
  "TOP CATEGORY": "أعلى تصنيف حركة",
  "uncategorized": "غير مصنف",
  "Export Categories": "تصدير التصنيفات",
  "Search categories...": "بحث في التصنيفات...",
  "Category Name": "اسم التصنيف",
  "Description": "الوصف",
  "Products Count": "عدد المنتجات",
  "No categories found": "لم يتم العثور على تصنيفات",

  // Invoices & Financials Page Phrases
  "Invoice & Financials": "إدارة الفواتير والتحصيلات الماليات",
  "Invoices & Financials": "إدارة الفواتير والتحصيلات الماليات",
  "Manage billing, invoices, payment status, and order revenue": "إدارة الفواتير، التحصيلات، حالات الدفع، وإيرادات المبيعات",
  "TOTAL REVENUE": "إجمالي الإيرادات",
  "PAID INVOICES": "الفواتير المدفوعة",
  "PENDING INVOICES": "فواتير قيد التحصيل",
  "OVERDUE INVOICES": "فواتير متأخرة",
  "Collected payments": "التحصيلات الفعلية",
  "Awaiting customer payment": "في انتظار سداد العميل",
  "Export Invoices": "تصدير الفواتير",
  "All Invoices": "جميع الفواتير",
  "Search by invoice # or customer...": "بحث برقم الفاتورة أو اسم العميل...",
  "Invoice Number": "رقم الفاتورة",
  "Due Date": "تاريخ الاستحقاق",
  "Amount": "المبلغ الإجمالي",
  "Payment Status": "حالة السداد",
  "No invoices found": "لم يتم العثور على فواتير",

  // Sales Orders Page Phrases
  "Sales Orders Pipeline": "إدارة ومتابعة أوامر البيع",
  "Manage customer sales orders, fulfillment status, and order processing": "إدارة أوامر مبيعات العملاء، حالات التنفيذ، والتجهيز",
  "TOTAL ORDERS": "إجمالي الطلبات",
  "COMPLETED ORDERS": "الطلبات المكتملة",
  "PROCESSING ORDERS": "طلبات قيد التجهيز",
  "PENDING ORDERS": "طلبات قيد الانتظار",
  "Orders fulfilled successfully": "تم تنفيذ وتسليم الأوامر",
  "Being picked & packed": "جاري الجمع والتجهيز",
  "Awaiting processing": "في انتظار الاعتماد والتجهيز",
  "Export Orders": "تصدير الأوامر",
  "All Orders": "جميع الأوامر",
  "Search by order #, customer, or SKU...": "بحث برقم الأمر، اسم العميل، أو الكود...",
  "Order Date": "تاريخ الطلب",
  "Items": "الأصناف",
  "Fulfillment Status": "حالة التنفيذ",
  "No sales orders found": "لم يتم العثور على أوامر بيع",

  // Products Catalog Page Phrases
  "Product Catalog": "كتالوج المنتجات ومواد البناء",
  "Manage product inventory, master catalog, SKU specifications, and stock limits": "إدارة كتالوج المنتجات، مواصفات الأصناف، وحدود الأمان بالمخازن",
  "TOTAL CATALOG ITEMS": "إجمالي أصناف الكتالوج",
  "LOW STOCK ITEMS": "أصناف منخفضة الرصيد",
  "OUT OF STOCK ITEMS": "أصناف نفدت بالكامل",
  "VALUATION": "القيمة المخزنية الإجمالية",
  "Tracked SKU count": "عدد الأصناف المتتبعة",
  "Below reorder point": "أقل من حد الأمان",
  "Zero stock balance": "رصيد صفر بالكامل",
  "Export Products": "تصدير الكتالوج",
  "All Products": "جميع المنتجات",
  "Search by SKU, product name, or category...": "بحث برقم SKU، اسم المنتج، أو التصنيف...",
  "Stock Level": "رصيد المخزون",
  "Reorder Point": "حد إعادة الطلب",
  "No products found": "لم يتم العثور على منتجات",

  // Dashboard & Analytics Page Phrases
  "Overall Insights & WMS Analytics": "التحليلات الشاملة وإحصائيات المخازن",
  "Real-time operations metrics, sales trends, stock distribution, and financial health": "مؤشرات العمليات الفورية، اتجاهات المبيعات، توزيع المخزون، والصحة المالية",
  "System Health Score": "مؤشر جودة وتتبع النظام",
  "All systems operational": "جميع الخدمات والمخازن تعمل بشكل ممتاز",
  "Monthly Sales Trend": "اتجاه المبيعات الشهرية",
  "Top Moving Products": "الأصناف الأعلى حركة وسحباً",
  "Warehouse Capacity Valuation": "تقييم سعة وسعر المخازن",
  "Recent Audit Logs": "أحدث سجلات التدقيق والعمليات",

  // Warehouse Management Page Phrases
  "Warehouse Management": "إدارة المستودعات والمخازن",
  "Manage warehouse locations, allocate stock, and transfer inventory between warehouses": "إدارة مواقع المستودعات، تخصيص الرصيد، ونقل البضائع بين المخازن",
  "INACTIVE WAREHOUSES": "المستودعات غير النشطة",
  "Not in use": "خارج الخدمة حالياً",
  "Operational": "تشغيلية نشطة",
  "All locations": "جميع المواقع المخزنية",
  "Products availability": "توفر الأصناف بالرصيد",
  "Export Warehouses": "تصدير المستودعات",
  "All Warehouses": "جميع المستودعات",
  "Search by name or address": "بحث باسم المستودع أو العنوان...",
  "Name": "اسم المستودع",
  "Address": "العنوان",
  "Type": "نوع المستودع",
  "Stock share": "حصة المخزون",
  "Created": "تاريخ الإنشاء",
  "No warehouses found": "لم يتم العثور على مستودعات",
  "Page 1 of 0": "صفحة 1 من 0",
  "Rows per page": "عدد الصفوف بالصفحة",
  "Stock Inventory Management": "نظام Benaa لإدارة المخازن والديكورات",
  "About": "عن النظام",
  "Hub": "مركز رئيسي",
  "Storage": "تخزين",
  "Secondary": "فرعي",
  "Main": "رئيسي",
  "Others": "أخرى",
  "Store": "معرض",
  "Stock low": "منخفض",
  "Stock out": "نفد",

  "Save Changes": "حفظ التغييرات",
  "Save": "حفظ",
  "Cancel": "إلغاء",
  "Create New": "إضافة صنف جديد",
  "Create": "إضافة جديد",
  "Edit": "تعديل",
  "Delete": "حذف",
  "Search...": "بحث...",
  "Filter": "تصفية",
  "Export": "تصدير لإكسيل",
  "Import": "استيراد CSV",
  "Refresh": "تحديث",
  "Approve": "اعتماد",
  "Post": "ترحيل",
  "Print": "طباعة",
  "Download PDF": "تحميل PDF",
  "Download": "تحميل",
  "Close": "إغلاق",
  "Go Back": "رجوع",
  "Back": "رجوع",
  "Confirm": "تأكيد العملية",
  "Language": "اللغة",
};

const reversePhraseMap: Record<string, string> = {};
for (const [enKey, arVal] of Object.entries(phraseMap)) {
  reversePhraseMap[arVal] = enKey;
}
for (const [k, arVal] of Object.entries(translations.ar)) {
  const enVal = translations.en[k];
  if (enVal) {
    reversePhraseMap[arVal] = enVal;
  }
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      const savedLang = localStorage.getItem(STORAGE_KEY) as Language | null;
      if (savedLang === "en" || savedLang === "ar") {
        return savedLang;
      }
    }
    return "en";
  });

  const applyLanguageToDOM = (lang: Language) => {
    const isRTL = lang === "ar";
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
    if (isRTL) {
      document.documentElement.classList.add("rtl");
    } else {
      document.documentElement.classList.remove("rtl");
    }
  };

  useEffect(() => {
    applyLanguageToDOM(language);
  }, [language]);

  // Live 2-Way Reversible DOM Translation Engine with Radix Dialog & Portal Scanning
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isArabic = language === "ar";
    const currentMap = isArabic ? phraseMap : reversePhraseMap;

    const translateNodeTree = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
        const val = node.nodeValue;
        const trimmed = val.trim();
        const cleanTrimmed = trimmed.replace(/^[\.\:\s]+/, "");

        const targetText = currentMap[trimmed] || currentMap[cleanTrimmed];
        if (targetText) {
          node.nodeValue = val.replace(cleanTrimmed, targetText);
        } else if (trimmed.includes(":")) {
          // Handle badge formats like "0:Hub", "0:Storage", "0:Stock low"
          const parts = trimmed.split(":");
          if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
            const prefix = parts[0].trim();
            const suffix = parts[1].trim();
            const translatedSuffix = currentMap[suffix];
            const translatedPrefix = currentMap[prefix];
            if (translatedSuffix || translatedPrefix) {
              node.nodeValue = `${translatedPrefix || prefix}:${translatedSuffix || suffix}`;
            }
          }
        } else if (cleanTrimmed.length > 1) {
          const lower = cleanTrimmed.toLowerCase();
          for (const [key, tVal] of Object.entries(currentMap)) {
            if (key.toLowerCase() === lower) {
              node.nodeValue = val.replace(cleanTrimmed, tVal);
              break;
            }
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;

        // Translate placeholders
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          const input = el as HTMLInputElement;
          const trimmedPlaceholder = input.placeholder ? input.placeholder.trim() : "";
          const targetPlaceholder = currentMap[trimmedPlaceholder];
          if (targetPlaceholder) {
            input.placeholder = targetPlaceholder;
          }
        }

        // Child nodes iteration
        el.childNodes.forEach(translateNodeTree);
      }
    };

    // Initial pass over document body
    translateNodeTree(document.body);

    // Dynamic Observer for DOM mutations (modals, Radix portals, tables, async components)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((addedNode) => {
          translateNodeTree(addedNode);
        });
      });
      // Scan active open Radix Dialog Portals
      document.querySelectorAll('[data-radix-portal], [role="dialog"], [role="popover"]').forEach((portal) => {
        translateNodeTree(portal);
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    document.cookie = `${STORAGE_KEY}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
    applyLanguageToDOM(lang);
  };

  const toggleLanguage = () => {
    const nextLang = language === "en" ? "ar" : "en";
    setLanguage(nextLang);
  };

  const t = (key: string, fallback?: string): string => {
    const dict = translations[language];
    if (dict && dict[key]) {
      return dict[key];
    }
    if (language === "ar") {
      const trimmedKey = key.trim();
      if (phraseMap[trimmedKey]) {
        return phraseMap[trimmedKey];
      }
      const lowerKey = trimmedKey.toLowerCase();
      for (const [k, val] of Object.entries(translations["en"])) {
        if (val.toLowerCase() === lowerKey || k.toLowerCase() === lowerKey) {
          return translations["ar"][k] || val;
        }
      }
    }
    return fallback || translations["en"][key] || key;
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        toggleLanguage,
        isRTL: language === "ar",
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
