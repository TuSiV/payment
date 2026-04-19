#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

def generate_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    center = size // 2
    scale = size / 512
    
    radius = int(70 * scale)
    draw.rounded_rectangle([0, 0, size, size], radius=radius, fill=None)
    
    gradient = Image.new('RGBA', (size, size))
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            r1, g1, b1 = 102, 126, 234
            r2, g2, b2 = 118, 75, 162
            r = int(r1 + (r2 - r1) * t)
            g = int(g1 + (g2 - g1) * t)
            b = int(b1 + (b2 - b1) * t)
            gradient.putpixel((x, y), (r, g, b, 255))
    
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    
    img = Image.composite(gradient, img, mask)
    
    doc_x = int(120 * scale)
    doc_y = int(110 * scale)
    doc_w = int(160 * scale)
    doc_h = int(210 * scale)
    
    doc = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    doc_draw = ImageDraw.Draw(doc)
    doc_draw.rounded_rectangle([doc_x, doc_y, doc_x + doc_w, doc_y + doc_h], 
                               radius=int(8 * scale), fill=(255, 255, 255, 255))
    
    for i in range(4):
        line_y = doc_y + int(45 * scale) + i * int(35 * scale)
        doc_draw.line([doc_x + int(20 * scale), line_y, 
                      doc_x + doc_w - int(20 * scale), line_y],
                     fill=(102, 126, 234, 77), width=int(3 * scale))
    
    fold_pts = [
        (doc_x + doc_w, doc_y),
        (doc_x + doc_w - int(40 * scale), doc_y),
        (doc_x + doc_w, doc_y + int(40 * scale))
    ]
    doc_draw.polygon(fold_pts, fill=(102, 126, 234, 204))
    
    sheet_x = int(240 * scale)
    sheet_y = int(170 * scale)
    sheet_w = int(150 * scale)
    sheet_h = int(180 * scale)
    
    sheet = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sheet_draw = ImageDraw.Draw(sheet)
    sheet_draw.rounded_rectangle([sheet_x, sheet_y, sheet_x + sheet_w, sheet_y + sheet_h],
                                 radius=int(8 * scale), fill=(240, 244, 255, 255))
    
    for i in range(5):
        line_y = sheet_y + int(30 * scale) + i * int(30 * scale)
        sheet_draw.line([sheet_x, line_y, sheet_x + sheet_w, line_y],
                       fill=(102, 126, 234, 64), width=int(2 * scale))
    
    sheet_draw.line([sheet_x + int(45 * scale), sheet_y, sheet_x + int(45 * scale), sheet_y + sheet_h],
                   fill=(102, 126, 234, 64), width=int(2 * scale))
    sheet_draw.line([sheet_x + int(90 * scale), sheet_y, sheet_x + int(90 * scale), sheet_y + sheet_h],
                   fill=(102, 126, 234, 64), width=int(2 * scale))
    
    sheet_draw.rounded_rectangle([sheet_x + int(8 * scale), sheet_y + int(8 * scale),
                                  sheet_x + int(38 * scale), sheet_y + int(24 * scale)],
                                 radius=int(4 * scale), fill=(102, 126, 234, 255))
    sheet_draw.rounded_rectangle([sheet_x + int(55 * scale), sheet_y + int(8 * scale),
                                  sheet_x + int(85 * scale), sheet_y + int(24 * scale)],
                                 radius=int(4 * scale), fill=(118, 75, 162, 255))
    
    shadow_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow_layer.paste(doc, (0, 0))
    shadow_layer.paste(sheet, (0, 0))
    shadow_blur = shadow_layer.filter(ImageFilter.GaussianBlur(int(10 * scale)))
    
    shadow_shifted = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow_shifted.paste(shadow_blur, (int(3 * scale), int(8 * scale)))
    shadow_shifted.putalpha(100)
    
    img = Image.alpha_composite(img, shadow_shifted)
    img = Image.alpha_composite(img, doc)
    img = Image.alpha_composite(img, sheet)
    
    return img

def main():
    icons_dir = os.path.join(os.path.dirname(__file__), 'src-tauri', 'icons')
    os.makedirs(icons_dir, exist_ok=True)
    
    sizes = [512, 256, 128, 64, 32, 16]
    
    for size in sizes:
        icon = generate_icon(size)
        if size == 512:
            icon.save(os.path.join(icons_dir, 'icon.png'))
        icon.save(os.path.join(icons_dir, f'{size}x{size}.png'))
        if size in [32, 64, 128, 256, 512]:
            icon.save(os.path.join(icons_dir, f'{size}x{size}@2x.png'))
    
    print(f'Icon generation complete! Icons saved to {icons_dir}')

if __name__ == '__main__':
    main()