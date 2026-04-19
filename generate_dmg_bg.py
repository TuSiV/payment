import sys
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

def create_dmg_background(output_path, width=660, height=400):
    # Create an image with a light gray/white background
    img = Image.new('RGBA', (width, height), color=(255, 255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    # Arrow parameters
    # The app is at x=180, y=170
    # Applications is at x=480, y=170
    # Arrow should go from approx x=250 to x=410
    start_x = 260
    end_x = 400
    y = 170

    # Draw arrow body
    arrow_color = (150, 150, 150, 255)
    draw.line([(start_x, y), (end_x, y)], fill=arrow_color, width=4)
    
    # Draw arrow head
    # A simple triangle at end_x
    arrow_head_size = 15
    draw.polygon([
        (end_x, y),
        (end_x - arrow_head_size, y - arrow_head_size),
        (end_x - arrow_head_size, y + arrow_head_size)
    ], fill=arrow_color)
    
    # Draw some text
    # Try to use a system font
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except IOError:
        font = ImageFont.load_default()

    text = "Drag to Applications"
    
    # Calculate text size using textbbox
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    
    text_x = (width - text_w) / 2
    text_y = y - 40
    
    draw.text((text_x, text_y), text, fill=(100, 100, 100, 255), font=font)

    # Save
    img.save(output_path)
    print(f"Saved to {output_path}")

if __name__ == "__main__":
    create_dmg_background("src-tauri/icons/dmg-background.png")
