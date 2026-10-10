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
      className="command-palette"
    >
      <CommandInput placeholder="Search pages, queues and actions…" />
      <CommandList>
        <CommandEmpty>
          <SearchX size={20} className="command-empty-icon" />
          No matching pages, queues or actions.
        </CommandEmpty>
        <CommandGroup heading="Pages">
          {nav.map((n, i) => (
            <CommandItem
              key={n.to}
              value={n.label}
              onSelect={run(() => navigate({ to: n.to }))}
            >
              <n.icon />
              {n.label}
              <CommandShortcut aria-hidden="true">
                {altLabel}
                {i + 1}
              </CommandShortcut>
            </CommandItem>
          ))}
          <CommandItem
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
            <CommandSeparator />
            <CommandGroup heading="Queues">
              {queues.data.data.map((q) => (
                <CommandItem
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
                  <span className="mono truncate">{q.name}</span>
                  <CommandShortcut className="command-meta">
                    {q.paused
                      ? "Paused"
                      : `${compactNumber(q.pending)} pending`}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="Toggle theme dark light mode"
            onSelect={run(toggle)}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </CommandItem>
          <CommandItem
            value="Refresh data"
            onSelect={run(invalidateOperational)}
          >
            <RefreshCw />
            Refresh data
          </CommandItem>
          {session.data?.auth_required && session.data.authenticated && (
            <CommandItem value="Sign out log out" onSelect={run(onSignOut)}>
              <LogOut />
              Sign out
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
      <div className="command-footer" aria-hidden="true">
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Navigate
        </span>
        <span>
          <Kbd>↵</Kbd>
          Open
        </span>
        <span>
          <Kbd>Esc</Kbd>
          Close
        </span>
      </div>
    </CommandDialog>
  );
}
