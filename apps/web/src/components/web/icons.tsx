import {
  ArchiveBoxIcon,
  ArrowUpTrayIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  MicrophoneIcon,
  PaperAirplaneIcon,
  PlusIcon as HeroPlusIcon,
  ShoppingCartIcon,
  SparklesIcon as HeroSparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/24/solid";
import type { ReactElement } from "react";
import { AppTab } from "./types";

type IconComponent = () => ReactElement;

export const navItems: Array<{ key: AppTab; href: string; label: string; title: string; icon: IconComponent }> = [
  { key: "assistant", href: "/", label: "Assistant", title: "Assistant", icon: SparklesIcon },
  { key: "inventory", href: "/inventory", label: "Inventory", title: "Inventory", icon: FridgeIcon },
  { key: "grocery", href: "/grocery", label: "Grocery", title: "Grocery", icon: CartIcon },
  { key: "meal-plans", href: "/meal-plans", label: "Plans", title: "Meal plans", icon: CalendarIcon },
  { key: "recipes", href: "/recipes", label: "Recipes", title: "Recipes", icon: RecipeIcon },
  { key: "household", href: "/household", label: "Household", title: "Household", icon: FamilyIcon },
  { key: "meal-logs", href: "/meal-logs", label: "Logs", title: "Meal logs", icon: LogIcon },
];

export function SparklesIcon() {
  return <HeroSparklesIcon />;
}

export function CartIcon() {
  return <ShoppingCartIcon />;
}

export function FridgeIcon() {
  return <ArchiveBoxIcon />;
}

export function FamilyIcon() {
  return <UserGroupIcon />;
}

export function CalendarIcon() {
  return <CalendarDaysIcon />;
}

export function RecipeIcon() {
  return <BookOpenIcon />;
}

export function LogIcon() {
  return <ClipboardDocumentListIcon />;
}

export function PlusIcon() {
  return <HeroPlusIcon />;
}

export function UploadIcon() {
  return <ArrowUpTrayIcon />;
}

export function SendIcon() {
  return <PaperAirplaneIcon />;
}

export function MicIcon() {
  return <MicrophoneIcon />;
}

export function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3.5h6.5L20 9v10.5A1.5 1.5 0 0 1 18.5 21h-11A1.5 1.5 0 0 1 6 19.5v-14A2 2 0 0 1 8 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14.5 3.5V9H20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
