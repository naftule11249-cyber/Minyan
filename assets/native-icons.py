# Generates Android/iOS launcher icons and splash screens from dist/icon-512.png and dist/icon-maskable-512.png.
import os, glob
from PIL import Image, ImageDraw
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist = os.path.join(root, 'docs'); android = os.path.join(root, 'app/android/app/src/main/res'); ios = os.path.join(root, 'app/ios/App/App/Assets.xcassets')
rounded = Image.open(os.path.join(dist, 'icon-512.png')).convert('RGBA')
maskable = Image.open(os.path.join(dist, 'icon-maskable-512.png')).convert('RGBA')
BAND = (34, 59, 104, 255)
def fit(im, size): return im.resize((size, size), Image.LANCZOS)
def circle(im, size):
    im = fit(im, size); mask = Image.new('L', (size, size), 0); ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(im, (0, 0), mask); return out
dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for d, s in dens.items():
    folder = os.path.join(android, 'mipmap-' + d); os.makedirs(folder, exist_ok=True)
    fit(rounded, int(48 * s)).save(os.path.join(folder, 'ic_launcher.png'))
    circle(maskable, int(48 * s)).save(os.path.join(folder, 'ic_launcher_round.png'))
    fit(maskable, int(108 * s)).save(os.path.join(folder, 'ic_launcher_foreground.png'))
with open(os.path.join(android, 'drawable/ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#223B68</color>\n</resources>\n')
def splash(w, h):
    im = Image.new('RGBA', (w, h), BAND); s = int(min(w, h) * 0.32); ic = fit(rounded, s); im.paste(ic, ((w - s) // 2, (h - s) // 2), ic); return im
for p in glob.glob(os.path.join(android, 'drawable*/splash.png')):
    w, h = Image.open(p).size; splash(w, h).save(p)
splash(1024, 1024).convert('RGB').save(os.path.join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png')) if False else fit(maskable, 1024).convert('RGB').save(os.path.join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'))
for p in glob.glob(os.path.join(ios, 'Splash.imageset/splash-2732x2732*.png')):
    splash(2732, 2732).convert('RGB').save(p)
print('native icons + splash written')
