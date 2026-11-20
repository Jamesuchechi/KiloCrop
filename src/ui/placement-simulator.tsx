import type { ComponentChildren } from 'preact';

export type SimulatorMode =
  | 'none'
  | 'linkedin-banner'
  | 'story-safe'
  | 'youtube-thumb'
  | 'circle-avatar'
  | 'og-card'
  | 'ig-post';

export const SIMULATOR_OPTIONS: ReadonlyArray<{ id: SimulatorMode; label: string }> = [
  { id: 'linkedin-banner', label: 'LinkedIn banner overlap' },
  { id: 'story-safe', label: 'Story safe zones' },
  { id: 'youtube-thumb', label: 'YouTube thumbnail card' },
  { id: 'circle-avatar', label: 'Circular avatar mask' },
  { id: 'og-card', label: 'Link preview (OG card)' },
  { id: 'ig-post', label: 'Instagram feed post' },
];

export function defaultSimulatorForPreset(presetId: string): SimulatorMode {
  if (presetId === 'linkedin-banner') return 'linkedin-banner';
  if (presetId === 'instagram-story') return 'story-safe';
  if (presetId === 'youtube-thumbnail') return 'youtube-thumb';
  if (presetId === 'whatsapp-profile' || presetId === 'app-icon') return 'circle-avatar';
  if (presetId === 'og-image') return 'og-card';
  if (presetId === 'instagram-post') return 'ig-post';
  return 'none';
}

export interface PlacementSimulatorProps {
  mode: SimulatorMode;
  children: ComponentChildren;
}

export function PlacementSimulator(props: PlacementSimulatorProps) {
  const { mode, children } = props;

  if (mode === 'none') {
    return <>{children}</>;
  }

  if (mode === 'circle-avatar') {
    return (
      <div class="sim-frame sim-circle">
        <div class="sim-circle-mask">{children}</div>
        <div class="sim-caption">Outer corners hidden inside circular avatars</div>
      </div>
    );
  }

  if (mode === 'linkedin-banner') {
    return (
      <div class="sim-frame sim-social-card">
        <div class="sim-li-hero">
          {children}
          <div class="sim-li-avatar" aria-hidden="true">
            KC
          </div>
        </div>
        <div class="sim-li-footer">
          <strong>Your Profile Name</strong>
          <span>Lower-left banner corner covered by profile picture</span>
        </div>
      </div>
    );
  }

  if (mode === 'story-safe') {
    return (
      <div class="sim-frame sim-story">
        <div class="sim-story-stage">
          {children}
          <div class="sim-story-top" aria-hidden="true">
            <div class="sim-story-bars">
              <span />
              <span />
            </div>
            <div class="sim-story-user">your_handle · Top header zone</div>
          </div>
          <div class="sim-story-bottom" aria-hidden="true">
            <span class="sim-story-reply">Send message…</span>
            <span class="sim-story-heart">Bottom UI zone</span>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'youtube-thumb') {
    return (
      <div class="sim-frame sim-social-card">
        <div class="sim-yt-stage">
          {children}
          <span class="sim-yt-pill" aria-hidden="true">
            12:48
          </span>
        </div>
        <div class="sim-yt-footer">
          <strong>Video Title Preview — Keep Key Text Away From Bottom-Right</strong>
          <span>Channel Name · 12K views</span>
        </div>
      </div>
    );
  }

  if (mode === 'ig-post') {
    return (
      <div class="sim-frame sim-social-card">
        <div class="sim-ig-header" aria-hidden="true">
          <strong>your_account</strong>
          <span>•••</span>
        </div>
        {children}
        <div class="sim-ig-footer" aria-hidden="true">
          <span>♡ Like · ○ Comment · ↗ Share</span>
        </div>
      </div>
    );
  }

  return (
    <div class="sim-frame sim-social-card">
      {children}
      <div class="sim-og-footer">
        <small>YOURSITE.COM</small>
        <strong>Link Preview Card Title (WhatsApp / X / Slack)</strong>
        <span>Verify headline hierarchy and edge cropping inside link embeds.</span>
      </div>
    </div>
  );
}
