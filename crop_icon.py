from PIL import Image, ImageDraw

def mask_squircle(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    
    # Create an anti-aliased mask by rendering at 4x resolution and downsampling
    scale = 4
    mask = Image.new("L", (width * scale, height * scale), 0)
    draw = ImageDraw.Draw(mask)
    
    # Apple squircle is often approximated by a rounded rectangle with radius = side * 0.225
    r = int(width * scale * 0.225)
    
    # We might want to bring it in just a tiny bit (e.g., 10 pixels * scale) 
    # to completely avoid any white fringe left by the AI generation.
    margin = int(width * scale * 0.02) # 2% margin to eat the white halo
    draw.rounded_rectangle(
        (margin, margin, width * scale - margin, height * scale - margin),
        radius=r, fill=255
    )
    
    # Downsample for perfect anti-aliasing
    mask = mask.resize((width, height), Image.LANCZOS)
    
    # Output image
    result = Image.new("RGBA", (width, height))
    result.paste(img, (0, 0), mask=mask)
    result.save(output_path, "PNG")

if __name__ == "__main__":
    import sys
    # path to the best icon
    original_icon = "/Users/chen/.gemini/antigravity/brain/6c6cae8e-e1bb-4c6d-984a-3ac26abbd26c/letter_generator_icon_1776582983216.png"
    mask_squircle(original_icon, "app-icon.png")
