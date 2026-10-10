import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Layers,
  LogOut,
  Moon,
  Pause,
  RefreshCw,
  SearchX,
  Settings,
  Sun,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { listQueuesOptions } from "../api/generated/@tanstack/react-query.gen";
import { invalidateOperational } from "../features/queries";
import { useSession } from "../features/session";
import { useTheme } from "./theme";
import { altLabel, compactNumber, nav } from "./nav";

const group =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:uppercase";
const item = "min-h-10 gap-2.5 rounded-lg";
const shortcut = "tracking-normal tabular-nums";
const key = "border text-2xs";
export function CommandPalette({
  open,
  onOpenChange,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const session = useSession();
  const { theme, toggle } = useTheme();
  const queues = useQuery({
    ...listQueuesOptions(),
    enabled: session.data?.authenticated === true,
  });
  const run = (action: () => void) => () => {
    action();
    onOpenChange(false);
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to…"
      description={`Search pages, queues and actions. Use ${altLabel}+1 through ${altLabel}+${nav.length} to jump between pages.`}
      showCloseButton={false}
      className="top-[8vh] max-w-[min(620px,calc(100%-2rem))] translate-y-0 gap-0 rounded-xl shadow-overlay sm:max-w-[min(620px,calc(100%-2rem))] md:top-[14vh] [&_[data-slot=command-input-wrapper]]:gap-2.5 [&_[data-slot=command-input-wrapper]]:px-4"
    >
      <CommandInput placeholder="Search pages, queues and actions…" />
      <CommandList className="max-h-[min(400px,60dvh)] py-1">
        <CommandEmpty>
          <SearchX
            size={20}
            className="mx-auto mb-2 block text-muted-foreground"
          />
          No matching pages, queues or actions.
        </CommandEmpty>
        <CommandGroup heading="Pages" className={group}>
          {nav.map((n, i) => (
            <CommandItem
              className={item}
              key={n.to}
              value={n.label}
              onSelect={run(() => navigate({ to: n.to }))}
            >
              <n.icon />
              {n.label}
              <CommandShortcut aria-hidden="true" className={shortcut}>
                {altLabel}
                {i + 1}
              </CommandShortcut>
            </CommandItem>
          ))}
          <CommandItem
            className={item}
            value="Settings & audit"
            keywords={["saved views", "audit log"]}
            onSelect={run(() => navigate({ to: "/settings" }))}
          >
            <Settings />
            Settings & audit
          </CommandItem>
        </CommandGroup>
        {!!queues.data?.data.length && (
          <>
            <CommandSeparator className="mx-0 my-1" />
            <CommandGroup heading="Queues" className={group}>
              {queues.data.data.map((q) => (
                <CommandItem
                  className={item}
                  key={q.name}
                  value={`queue ${q.name}`}
                  onSelect={run(() =>
                    navigate({
                      to: "/queues/$queue",
                      params: { queue: q.name },
                    }),
                  )}
                >
                  {q.paused ? <Pause /> : <Layers />}
                  <span className="font-mono truncate">{q.name}</span>
                  <CommandShortcut className={shortcut}>
                    {q.paused
                      ? "Paused"
                      : `${compactNumber(q.pending)} pending`}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator className="mx-0 my-1" />
        <CommandGroup heading="Actions" className={group}>
          <CommandItem
            className={item}
            value="Toggle theme dark light mode"
            onSelect={run(toggle)}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </CommandItem>
          <CommandItem
            className={item}
            value="Refresh data"
            onSelect={run(invalidateOperational)}
          >
            <RefreshCw />
            Refresh data
          </CommandItem>
          {session.data?.auth_required && session.data.authenticated && (
            <CommandItem
              value="Sign out log out"
              className={item}
              onSelect={run(onSignOut)}
            >
              <LogOut />
              Sign out
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
      <div
        className="hidden gap-4 border-t bg-background px-4 py-[9px] text-2xs/normal text-muted-foreground md:flex"
        aria-hidden="true"
      >
        <span className="inline-flex items-center gap-1">
          <Kbd className={key}>↑</Kbd>
          <Kbd className={key}>↓</Kbd>
          Navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd className={key}>↵</Kbd>
          Open
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd className={key}>Esc</Kbd>
          Close
        </span>
      </div>
    </CommandDialog>
  );
}
