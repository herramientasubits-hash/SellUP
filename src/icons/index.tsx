// Iconos del sistema — familia Hugeicons «stroke rounded», la misma que usa Thema
// (`src/icons` en el repo Thema). Este módulo es el ÚNICO sitio que importa la
// librería de iconos: las pantallas piden el icono por su nombre de siempre
// (`Building2`, `Users`, `Search`…) y aquí se decide qué dibujo le corresponde.
//
// Los nombres y las props (`className`, `size`, `strokeWidth`) son los mismos
// que ya usaba SellUp, así que cambiar de familia no obliga a tocar pantallas:
// basta con cambiar este mapa.
//
// GENERADO a partir del mapa nombre → Hugeicons. Para añadir un icono: importa
// su dibujo de `@hugeicons/core-free-icons` y añade una línea `export const`.
import { forwardRef } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Activity01Icon,
  AiBrain01Icon,
  Alert02Icon,
  AlertCircleIcon,
  Archive02Icon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowExpand01Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  BankIcon,
  BarChartIcon,
  BotIcon,
  Brain02Icon,
  Briefcase01Icon,
  Building03Icon,
  Calendar03Icon,
  Call02Icon,
  CallRinging04Icon,
  Cancel01Icon,
  CancelCircleIcon,
  ChartColumnIcon,
  ChartDecreaseIcon,
  ChartIncreaseIcon,
  CheckmarkCircle02Icon,
  CircleArrowRight02Icon,
  ClipboardPasteIcon,
  Clock01Icon,
  CloudIcon,
  Coins01Icon,
  ComputerIcon,
  Copy01Icon,
  CopyCheckIcon,
  CpuIcon,
  CrownIcon,
  CursorPointer02Icon,
  DashboardSpeed01Icon,
  DashboardSquare01Icon,
  DashedLineCircleIcon,
  Database01Icon,
  Delete02Icon,
  Dollar01Icon,
  DragDropHorizontalIcon,
  DragDropVerticalIcon,
  File01Icon,
  File02Icon,
  FileAudioIcon,
  FileSearchIcon,
  FileValidationIcon,
  FileVideoIcon,
  FileZipIcon,
  FilterHorizontalIcon,
  FilterIcon,
  FlashIcon,
  FloppyDiskIcon,
  Folder01Icon,
  FolderOpenIcon,
  GitBranchIcon,
  GitMergeIcon,
  Globe02Icon,
  HardDriveIcon,
  HashtagIcon,
  HelpCircleIcon,
  Idea01Icon,
  Image01Icon,
  InboxIcon,
  InformationCircleIcon,
  Invoice01Icon,
  Key01Icon,
  Layers01Icon,
  LayoutBottomIcon,
  LayoutRightIcon,
  LayoutThreeColumnIcon,
  Link02Icon,
  LinkSquare02Icon,
  ListViewIcon,
  Location01Icon,
  Logout01Icon,
  Mail01Icon,
  Message01Icon,
  Message02Icon,
  MinusSignIcon,
  Moon02Icon,
  Minimize01Icon,
  MoreHorizontalIcon,
  Move02Icon,
  Notification03Icon,
  PackageOpenIcon,
  PaintBoardIcon,
  PauseCircleIcon,
  PauseIcon,
  PencilEdit01Icon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Plug01Icon,
  PlugSocketIcon,
  PlusSignIcon,
  PowerSocket01Icon,
  RecordIcon,
  Refresh01Icon,
  RefreshIcon,
  Scroll01Icon,
  Search01Icon,
  SecurityCheckIcon,
  SecurityWarningIcon,
  SentIcon,
  Settings02Icon,
  Settings04Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareLock02Icon,
  StarIcon,
  StickyNote01Icon,
  Structure01Icon,
  Structure03Icon,
  Sun03Icon,
  Table01Icon,
  Tag01Icon,
  Target02Icon,
  TaskDone02Icon,
  TestTube01Icon,
  Tick02Icon,
  TickDouble02Icon,
  ToggleOffIcon,
  UnavailableIcon,
  Undo02Icon,
  UnfoldMoreIcon,
  Upload01Icon,
  UserAdd01Icon,
  UserCheck01Icon,
  UserIcon,
  UserMultiple02Icon,
  UserRemove01Icon,
  UserSearch01Icon,
  UserSettings01Icon,
  ViewIcon,
  ViewOffIcon,
  Wallet01Icon,
  WifiDisconnected01Icon,
  WorkHistoryIcon,
  WorkflowSquare03Icon,
  Xls01Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
  AttachmentIcon,
  FolderAddIcon,
  MagicWand01Icon,
  StopIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@hugeicons/core-free-icons";

// El spinner conserva el dibujo anterior: es el único icono que gira y su
// trazo está pensado para eso.
export { Loader2 } from "lucide-react";
export type { LucideIcon, LucideProps } from "lucide-react";

/** Grosor de trazo de la familia en todo el sistema (igual que en Thema). */
export const CornerDownLeft = createIcon(ArrowTurnBackwardIcon, "CornerDownLeft");
export const ICON_STROKE_WIDTH = 1.5;

/**
 * Envuelve un dibujo de Hugeicons con la misma firma que tenían los iconos de
 * SellUp, para que sirva donde una prop pide un `LucideIcon`.
 */
function createIcon(icon: IconSvgElement, displayName: string): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(
    ({ size = 24, strokeWidth = ICON_STROKE_WIDTH, color, absoluteStrokeWidth, ...props }, ref) => (
      <HugeiconsIcon
        ref={ref}
        icon={icon}
        size={size}
        strokeWidth={Number(strokeWidth)}
        absoluteStrokeWidth={absoluteStrokeWidth}
        color={color ?? "currentColor"}
        {...props}
      />
    ),
  );
  Icon.displayName = displayName;
  return Icon as unknown as LucideIcon;
}

export const Activity = createIcon(Activity01Icon, "Activity");
export const AlertCircle = createIcon(AlertCircleIcon, "AlertCircle");
export const AlertTriangle = createIcon(Alert02Icon, "AlertTriangle");
export const Archive = createIcon(Archive02Icon, "Archive");
export const ArrowDown = createIcon(ArrowDown02Icon, "ArrowDown");
export const ArrowLeft = createIcon(ArrowLeft02Icon, "ArrowLeft");
export const ArrowRight = createIcon(ArrowRight02Icon, "ArrowRight");
export const ArrowRightCircle = createIcon(CircleArrowRight02Icon, "ArrowRightCircle");
export const ArrowUp = createIcon(ArrowUp02Icon, "ArrowUp");
export const Ban = createIcon(UnavailableIcon, "Ban");
export const BarChart2 = createIcon(BarChartIcon, "BarChart2");
export const BarChart3 = createIcon(ChartColumnIcon, "BarChart3");
export const Bell = createIcon(Notification03Icon, "Bell");
export const Bot = createIcon(BotIcon, "Bot");
export const Brain = createIcon(Brain02Icon, "Brain");
export const BrainCircuit = createIcon(AiBrain01Icon, "BrainCircuit");
export const Briefcase = createIcon(Briefcase01Icon, "Briefcase");
export const Building2 = createIcon(Building03Icon, "Building2");
export const Calendar = createIcon(Calendar03Icon, "Calendar");
export const CalendarIcon = createIcon(Calendar03Icon, "CalendarIcon");
export const Check = createIcon(Tick02Icon, "Check");
export const CheckCheck = createIcon(TickDouble02Icon, "CheckCheck");
export const CheckCircle = createIcon(CheckmarkCircle02Icon, "CheckCircle");
export const CheckCircle2 = createIcon(CheckmarkCircle02Icon, "CheckCircle2");
export const CheckIcon = createIcon(Tick02Icon, "CheckIcon");
export const ChevronDown = createIcon(ArrowDown01Icon, "ChevronDown");
export const ChevronDownIcon = createIcon(ArrowDown01Icon, "ChevronDownIcon");
export const ChevronLeft = createIcon(ArrowLeft01Icon, "ChevronLeft");
export const ChevronLeftIcon = createIcon(ArrowLeft01Icon, "ChevronLeftIcon");
export const ChevronRight = createIcon(ArrowRight01Icon, "ChevronRight");
export const ChevronRightIcon = createIcon(ArrowRight01Icon, "ChevronRightIcon");
export const ChevronUp = createIcon(ArrowUp01Icon, "ChevronUp");
export const ChevronUpIcon = createIcon(ArrowUp01Icon, "ChevronUpIcon");
export const ChevronsUpDown = createIcon(UnfoldMoreIcon, "ChevronsUpDown");
export const CircleCheck = createIcon(CheckmarkCircle02Icon, "CircleCheck");
export const CircleDashed = createIcon(DashedLineCircleIcon, "CircleDashed");
export const CircleDot = createIcon(RecordIcon, "CircleDot");
export const CircleHelp = createIcon(HelpCircleIcon, "CircleHelp");
export const CircleSlash = createIcon(UnavailableIcon, "CircleSlash");
export const ClipboardCheck = createIcon(TaskDone02Icon, "ClipboardCheck");
export const ClipboardPaste = createIcon(ClipboardPasteIcon, "ClipboardPaste");
export const Clock = createIcon(Clock01Icon, "Clock");
export const Cloud = createIcon(CloudIcon, "Cloud");
export const Coins = createIcon(Coins01Icon, "Coins");
export const Columns3 = createIcon(LayoutThreeColumnIcon, "Columns3");
export const Copy = createIcon(Copy01Icon, "Copy");
export const CopyCheck = createIcon(CopyCheckIcon, "CopyCheck");
export const Cpu = createIcon(CpuIcon, "Cpu");
export const Crown = createIcon(CrownIcon, "Crown");
export const Database = createIcon(Database01Icon, "Database");
export const DollarSign = createIcon(Dollar01Icon, "DollarSign");
export const Ellipsis = createIcon(MoreHorizontalIcon, "Ellipsis");
export const ExternalLink = createIcon(LinkSquare02Icon, "ExternalLink");
export const Eye = createIcon(ViewIcon, "Eye");
export const EyeOff = createIcon(ViewOffIcon, "EyeOff");
export const File = createIcon(File01Icon, "File");
export const FileArchive = createIcon(FileZipIcon, "FileArchive");
export const FileAudio = createIcon(FileAudioIcon, "FileAudio");
export const FileCheck2 = createIcon(FileValidationIcon, "FileCheck2");
export const FileImage = createIcon(Image01Icon, "FileImage");
export const FileSearch = createIcon(FileSearchIcon, "FileSearch");
export const FileSpreadsheet = createIcon(Xls01Icon, "FileSpreadsheet");
export const FileText = createIcon(File02Icon, "FileText");
export const FileVideo = createIcon(FileVideoIcon, "FileVideo");
export const Filter = createIcon(FilterIcon, "Filter");
export const FlaskConical = createIcon(TestTube01Icon, "FlaskConical");
export const Folder = createIcon(Folder01Icon, "Folder");
export const FolderOpen = createIcon(FolderOpenIcon, "FolderOpen");
export const Gauge = createIcon(DashboardSpeed01Icon, "Gauge");
export const GitBranch = createIcon(GitBranchIcon, "GitBranch");
export const GitMerge = createIcon(GitMergeIcon, "GitMerge");
export const Globe = createIcon(Globe02Icon, "Globe");
export const GripHorizontal = createIcon(DragDropHorizontalIcon, "GripHorizontal");
export const GripVertical = createIcon(DragDropVerticalIcon, "GripVertical");
export const HardDrive = createIcon(HardDriveIcon, "HardDrive");
export const Hash = createIcon(HashtagIcon, "Hash");
export const History = createIcon(WorkHistoryIcon, "History");
export const Inbox = createIcon(InboxIcon, "Inbox");
export const Info = createIcon(InformationCircleIcon, "Info");
export const Key = createIcon(Key01Icon, "Key");
export const KeyRound = createIcon(Key01Icon, "KeyRound");
export const Landmark = createIcon(BankIcon, "Landmark");
export const Layers = createIcon(Layers01Icon, "Layers");
export const LayoutDashboard = createIcon(DashboardSquare01Icon, "LayoutDashboard");
export const LayoutList = createIcon(ListViewIcon, "LayoutList");
export const Lightbulb = createIcon(Idea01Icon, "Lightbulb");
export const Link2 = createIcon(Link02Icon, "Link2");
export const ListFilter = createIcon(FilterHorizontalIcon, "ListFilter");
export const ListTree = createIcon(Structure01Icon, "ListTree");
export const Lock = createIcon(SquareLock02Icon, "Lock");
export const LogOut = createIcon(Logout01Icon, "LogOut");
export const Mail = createIcon(Mail01Icon, "Mail");
export const MapPin = createIcon(Location01Icon, "MapPin");
export const Maximize2 = createIcon(ArrowExpand01Icon, "Maximize2");
export const MessageSquare = createIcon(Message01Icon, "MessageSquare");
export const MessageSquareText = createIcon(Message02Icon, "MessageSquareText");
export const Minus = createIcon(MinusSignIcon, "Minus");
export const Monitor = createIcon(ComputerIcon, "Monitor");
export const Moon = createIcon(Moon02Icon, "Moon");
export const Minimize2 = createIcon(Minimize01Icon, "Minimize2");
export const MoreHorizontal = createIcon(MoreHorizontalIcon, "MoreHorizontal");
export const MousePointerClick = createIcon(CursorPointer02Icon, "MousePointerClick");
export const Move = createIcon(Move02Icon, "Move");
export const Network = createIcon(Structure03Icon, "Network");
export const OctagonX = createIcon(CancelCircleIcon, "OctagonX");
export const PackageOpen = createIcon(PackageOpenIcon, "PackageOpen");
export const Palette = createIcon(PaintBoardIcon, "Palette");
export const PanelBottom = createIcon(LayoutBottomIcon, "PanelBottom");
export const PanelLeft = createIcon(SidebarLeft01Icon, "PanelLeft");
export const PanelLeftClose = createIcon(SidebarLeft01Icon, "PanelLeftClose");
export const PanelLeftOpen = createIcon(SidebarRight01Icon, "PanelLeftOpen");
export const PanelRight = createIcon(LayoutRightIcon, "PanelRight");
export const Pause = createIcon(PauseIcon, "Pause");
export const PauseCircle = createIcon(PauseCircleIcon, "PauseCircle");
export const PenLine = createIcon(PencilEdit02Icon, "PenLine");
export const Pencil = createIcon(PencilEdit01Icon, "Pencil");
export const Phone = createIcon(Call02Icon, "Phone");
export const PhoneCall = createIcon(CallRinging04Icon, "PhoneCall");
export const Pin = createIcon(PinIcon, "Pin");
export const PinOff = createIcon(PinOffIcon, "PinOff");
export const Plug = createIcon(Plug01Icon, "Plug");
export const PlugZap = createIcon(PlugSocketIcon, "PlugZap");
export const Plus = createIcon(PlusSignIcon, "Plus");
export const Power = createIcon(PowerSocket01Icon, "Power");
export const PowerOff = createIcon(ToggleOffIcon, "PowerOff");
export const ReceiptText = createIcon(Invoice01Icon, "ReceiptText");
export const RefreshCcw = createIcon(Refresh01Icon, "RefreshCcw");
export const RefreshCw = createIcon(RefreshIcon, "RefreshCw");
export const RotateCcw = createIcon(Undo02Icon, "RotateCcw");
export const Save = createIcon(FloppyDiskIcon, "Save");
export const ScrollText = createIcon(Scroll01Icon, "ScrollText");
export const Search = createIcon(Search01Icon, "Search");
export const SendHorizonal = createIcon(SentIcon, "SendHorizonal");
export const Settings = createIcon(Settings02Icon, "Settings");
export const Settings2 = createIcon(Settings04Icon, "Settings2");
export const ShieldAlert = createIcon(SecurityWarningIcon, "ShieldAlert");
export const ShieldCheck = createIcon(SecurityCheckIcon, "ShieldCheck");
export const SlidersHorizontal = createIcon(SlidersHorizontalIcon, "SlidersHorizontal");
export const Sparkles = createIcon(SparklesIcon, "Sparkles");
export const Star = createIcon(StarIcon, "Star");
export const StickyNote = createIcon(StickyNote01Icon, "StickyNote");
export const Sun = createIcon(Sun03Icon, "Sun");
export const Table2 = createIcon(Table01Icon, "Table2");
export const Tag = createIcon(Tag01Icon, "Tag");
export const Target = createIcon(Target02Icon, "Target");
export const Trash2 = createIcon(Delete02Icon, "Trash2");
export const TrendingDown = createIcon(ChartDecreaseIcon, "TrendingDown");
export const TrendingUp = createIcon(ChartIncreaseIcon, "TrendingUp");
export const TriangleAlert = createIcon(Alert02Icon, "TriangleAlert");
export const Unplug = createIcon(PlugSocketIcon, "Unplug");
export const Upload = createIcon(Upload01Icon, "Upload");
export const User = createIcon(UserIcon, "User");
export const UserCheck = createIcon(UserCheck01Icon, "UserCheck");
export const UserCog = createIcon(UserSettings01Icon, "UserCog");
export const UserPlus = createIcon(UserAdd01Icon, "UserPlus");
export const UserRoundX = createIcon(UserRemove01Icon, "UserRoundX");
export const UserSearch = createIcon(UserSearch01Icon, "UserSearch");
export const UserX = createIcon(UserRemove01Icon, "UserX");
export const Users = createIcon(UserMultiple02Icon, "Users");
export const Wallet = createIcon(Wallet01Icon, "Wallet");
export const WifiOff = createIcon(WifiDisconnected01Icon, "WifiOff");
export const Workflow = createIcon(WorkflowSquare03Icon, "Workflow");
export const X = createIcon(Cancel01Icon, "X");
export const XCircle = createIcon(CancelCircleIcon, "XCircle");
export const XIcon = createIcon(Cancel01Icon, "XIcon");
export const Zap = createIcon(FlashIcon, "Zap");
export const ZoomIn = createIcon(ZoomInAreaIcon, "ZoomIn");
export const ZoomOut = createIcon(ZoomOutAreaIcon, "ZoomOut");
// Chat de IA (Thema · chat): adjuntar, detener, útil / no útil, novedad.
export const Paperclip = createIcon(AttachmentIcon, "Paperclip");
export const FolderPlus = createIcon(FolderAddIcon, "FolderPlus");
export const Wand = createIcon(MagicWand01Icon, "Wand");
export const Square = createIcon(StopIcon, "Square");
export const ThumbsDown = createIcon(ThumbsDownIcon, "ThumbsDown");
export const ThumbsUp = createIcon(ThumbsUpIcon, "ThumbsUp");
