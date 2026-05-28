# El Pueblo TV Menu Board — Raspberry Pi Setup

One-time setup per Pi. After this, you never touch the Pi to update menu content — just edit `content/menu-board.json` and push to git.

## What this does

- Boots the Pi straight into fullscreen Chromium showing the menu board
- No desktop, no mouse, no UI chrome
- Auto-reloads every 5 minutes to pick up content changes
- Disables screen blanking so the TV never sleeps

## Per-Pi assignment

Assign each Pi to one board:

- **Board 1** (Breakfast · Burritos · Dinners): `https://elpueblomex.com/menu-board-1/`
- **Board 2** (Tacos · Tortas · Sides): `https://elpueblomex.com/menu-board-2/`

Track which Pi is which (e.g., sticker on the Pi or note in your remote.it dashboard).

## Setup steps (SSH in via remote.it)

### 1. Install Chromium (skip if already installed)

```bash
sudo apt update
sudo apt install -y chromium-browser unclutter
```

`unclutter` hides the mouse cursor after a few seconds of inactivity.

### 2. Disable screen blanking

Edit the lightdm config:

```bash
sudo nano /etc/lightdm/lightdm.conf
```

Under `[Seat:*]`, add:

```
xserver-command=X -s 0 -dpms
```

### 3. Create the kiosk autostart

```bash
mkdir -p ~/.config/lxsession/LXDE-pi
nano ~/.config/lxsession/LXDE-pi/autostart
```

Paste this (change the URL to board-1 or board-2 depending on the TV):

```
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.1 -root
@chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-translate --disable-features=TranslateUI --check-for-update-interval=31536000 --app=https://elpueblomex.com/menu-board-1/
```

Save and exit (Ctrl+O, Enter, Ctrl+X in nano).

### 4. Reboot

```bash
sudo reboot
```

When the Pi comes back up, the TV should boot straight into fullscreen menu.

## How updates work

After setup, the update flow is:

1. Edit `content/menu-board.json` in the repo (laptop or GitHub.com on your phone)
2. `git push`
3. Vercel rebuilds in ~30s
4. All TVs auto-reload on their next 5-minute tick
5. New menu visible everywhere

No Pi logins required for routine updates.

## Troubleshooting

**TV shows a black screen on boot**
- HDMI not connected. Power-cycle the TV first, then the Pi.

**TV shows a desktop instead of the menu**
- The autostart script didn't load. SSH in, verify `~/.config/lxsession/LXDE-pi/autostart` exists and has the right content.

**Menu is stuck on an old version**
- Force a reload: SSH in, run `DISPLAY=:0 xdotool key F5` (requires `sudo apt install xdotool` first)
- Or `sudo reboot` to fully restart

**TV is showing the WRONG board (board-1 instead of board-2 or vice versa)**
- Edit the autostart file, change `menu-board-1` to `menu-board-2` (or back), `sudo reboot`.

**Pi is offline / no internet**
- Currently the TV will fail to load. Once we add the service worker (planned next), the TV will keep showing the last cached version.

## Future: service worker for offline support

This first version requires internet to load the page. The next iteration will add a service worker that caches the menu locally so:

- First successful load caches everything
- If internet drops, the TV keeps showing the last good version
- When internet returns, it silently refreshes

Until then, treat internet at each location as a hard dependency.
