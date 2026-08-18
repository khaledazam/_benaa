"use client";

/**
 * Reusable Language Toggle Button (English / العربية)
 * Can be placed in Navbar, Auth Pages, and Layout Headers.
 */
import React from "react";
import { Globe } from "lucide-react";
import { useLanguage } from "@/contexts/language-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DROPDOWN_NAV_CONTENT_CLASS,
  DROPDOWN_NAV_ITEM_CLASS,
} from "@/components/ui/menu-item-styles";

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Toggle language"
          className="h-9 px-3 gap-2 rounded-full border-2 border-sky-500/60 dark:border-sky-400/60 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/80 text-sky-800 dark:text-sky-200 font-bold text-xs sm:text-sm shadow-md transition-all focus-visible:outline-none focus:outline-none focus-visible:ring-0 focus:ring-0 cursor-pointer"
        >
          <Globe className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <span>{language === "ar" ? "العربية" : "English"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={`w-44 ${DROPDOWN_NAV_CONTENT_CLASS}`}
      >
        <DropdownMenuItem
          onClick={() => setLanguage("en")}
          className={`${DROPDOWN_NAV_ITEM_CLASS} ${language === "en" ? "font-bold text-sky-600 dark:text-sky-400" : ""}`}
        >
          English
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setLanguage("ar")}
          className={`${DROPDOWN_NAV_ITEM_CLASS} ${language === "ar" ? "font-bold text-sky-600 dark:text-sky-400" : ""}`}
        >
          العربية (Arabic)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
