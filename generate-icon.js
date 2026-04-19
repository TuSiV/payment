const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(ctx, size) {
    const center = size / 2;
    const scale = size / 512;

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    
    const radius = 70 * scale;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.arcTo(size, 0, size, size, radius);
    ctx.arcTo(size, size, 0, size, radius);
    ctx.arcTo(0, size, 0, 0, radius);
    ctx.arcTo(0, 0, size, 0, radius);
    ctx.closePath();
    
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 20 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 5 * scale;

    const docX = 120 * scale;
    const docY = 110 * scale;
    const docW = 160 * scale;
    const docH = 210 * scale;
    
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 20 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6 * scale;
    roundRect(ctx, docX, docY, docW, docH, 8 * scale);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(102, 126, 234, 0.3)';
    ctx.lineWidth = 3 * scale;
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(docX + 20 * scale, docY + 45 * scale + i * 35 * scale);
        ctx.lineTo(docX + docW - 20 * scale, docY + 45 * scale + i * 35 * scale);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(102, 126, 234, 0.8)';
    ctx.beginPath();
    ctx.moveTo(docX + docW, docY);
    ctx.lineTo(docX + docW - 40 * scale, docY);
    ctx.lineTo(docX + docW, docY + 40 * scale);
    ctx.closePath();
    ctx.fill();

    const sheetX = 240 * scale;
    const sheetY = 170 * scale;
    const sheetW = 150 * scale;
    const sheetH = 180 * scale;

    ctx.fillStyle = '#f0f4ff';
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 25 * scale;
    ctx.shadowOffsetX = 3 * scale;
    ctx.shadowOffsetY = 8 * scale;
    roundRect(ctx, sheetX, sheetY, sheetW, sheetH, 8 * scale);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(102, 126, 234, 0.25)';
    ctx.lineWidth = 2 * scale;
    
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(sheetX, sheetY + 30 * scale + i * 30 * scale);
        ctx.lineTo(sheetX + sheetW, sheetY + 30 * scale + i * 30 * scale);
        ctx.stroke();
    }
    
    ctx.beginPath();
    ctx.moveTo(sheetX + 45 * scale, sheetY);
    ctx.lineTo(sheetX + 45 * scale, sheetY + sheetH);
    ctx.moveTo(sheetX + 90 * scale, sheetY);
    ctx.lineTo(sheetX + 90 * scale, sheetY + sheetH);
    ctx.stroke();

    ctx.fillStyle = '#667eea';
    roundRect(ctx, sheetX + 8 * scale, sheetY + 8 * scale, 30 * scale, 16 * scale, 4 * scale);
    ctx.fill();
    ctx.fillStyle = '#764ba2';
    roundRect(ctx, sheetX + 55 * scale, sheetY + 8 * scale, 30 * scale, 16 * scale, 4 * scale);
    ctx.fill();

    ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

async function main() {
    const iconsDir = path.join(__dirname, 'src-tauri', 'icons');
    
    if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
    }

    const sizes = [512, 256, 128, 64, 32, 16];

    for (const size of sizes) {
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        drawIcon(ctx, size);
        
        const buffer = canvas.toBuffer('image/png');
        
        if (size === 512) {
            fs.writeFileSync(path.join(iconsDir, 'icon.png'), buffer);
        }
        fs.writeFileSync(path.join(iconsDir, `${size}x${size}.png`), buffer);
        
        if ([32, 64, 128, 256, 512].includes(size)) {
            fs.writeFileSync(path.join(iconsDir, `${size}x${size}@2x.png`), buffer);
        }
    }

    console.log(`Icon generation complete! Icons saved to ${iconsDir}');
}

main().catch(console.error);