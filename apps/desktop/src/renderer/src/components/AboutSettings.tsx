import { useEffect, useState } from "react";
import appIcon from "../../../../resources/icon.png";
import { api } from "../lib/api";
import { ABOUT_RESOURCES, normalizeAppVersion, type AboutResourceId } from "../lib/about";
import { useT } from "../lib/i18n";
import { Button, Description } from "./ui";
import { IconBookOpen, IconBug, IconGitFork } from "./icons";

const RESOURCE_ICONS: Record<AboutResourceId, typeof IconGitFork> = {
  repository: IconGitFork,
  documentation: IconBookOpen,
  issues: IconBug,
};

export function AboutSettings(): React.JSX.Element {
  const { t } = useT();
  const [version, setVersion] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void api.system.version().then(
      (value) => {
        if (!cancelled) setVersion(normalizeAppVersion(value));
      },
      () => {
        if (!cancelled) setVersion(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const versionLabel =
    version === undefined
      ? t("about.version.loading")
      : (version ?? t("about.version.unavailable"));

  return (
    <section className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center py-8">
      <header className="flex items-center gap-5">
        <img
          src={appIcon}
          alt=""
          width={80}
          height={80}
          draggable={false}
          className="size-20 shrink-0 rounded-xl shadow-sm ring-1 ring-border"
        />
        <div className="min-w-0">
          <p className="text-xs font-medium text-accent">{t("about.product")}</p>
          <h3 className="mt-1 text-2xl font-semibold leading-tight">Paimon</h3>
          <Description className="mt-1">{t("shell.tagline")}</Description>
        </div>
      </header>

      <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground">
        {t("about.description")}
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t("about.version")}</dt>
          <dd className="break-words font-mono text-sm font-medium">{versionLabel}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t("about.license")}</dt>
          <dd className="text-sm font-medium">MIT</dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-col gap-3">
        <h4 className="text-sm font-medium">{t("about.resources")}</h4>
        <div className="flex flex-wrap gap-2">
          {ABOUT_RESOURCES.map((resource) => {
            const Icon = RESOURCE_ICONS[resource.id];
            return (
              <Button
                key={resource.id}
                variant={resource.id === "repository" ? "primary" : "outline"}
                size="sm"
                onPress={() => window.open(resource.href, "_blank", "noopener,noreferrer")}
              >
                <Icon data-icon="inline-start" aria-hidden="true" />
                {t(`about.action.${resource.id}`)}
              </Button>
            );
          })}
        </div>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">Copyright (c) 2026 Bess Croft</p>
    </section>
  );
}
