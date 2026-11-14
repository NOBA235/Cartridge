import { useId } from 'react';
import { settings } from '@/settings';
import { useSettings } from '@/ui/hooks/useStores';
import { Switch } from '@/ui/primitives/switch';

/** 'Ask the cloud when needed'. Ask screen: user choice. Blueprint canvas: off and locked. */
export function CloudSetting({ screen }: { screen: 'ask' | 'canvas' }) {
  const s = useSettings();
  const id = useId();
  const locked = screen === 'canvas';
  const on = locked ? false : s.cloudWhenNeeded.ask;
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={on}
        disabled={locked}
        onCheckedChange={(v) => settings.setAskCloudWhenNeeded(v)}
        aria-describedby={`${id}-desc`}
        className="mt-0.5"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          Ask the cloud when needed{locked && ' (off, locked)'}
        </label>
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {locked
            ? 'The Blueprint canvas makes no automatic cloud calls at all.'
            : 'Questions go to the cloud only when the cartridge cannot answer and this is on. Every such call shows in the \u2018What left this device\u2019 panel.'}
        </p>
      </div>
    </div>
  );
}
