(function initializeSkuReference(global) {
    const productTypes = [
        { code: 'SLD', name: 'ประตูบานเลื่อน' },
        { code: 'SLWD', name: 'หน้าต่างบานเลื่อน' },
        { code: 'CMD', name: 'ประตูบานเปิด' },
        { code: 'CMWD', name: 'หน้าต่างบานเปิด' },
        { code: 'ANWD', name: 'หน้าต่างบานประทุ้ง' },
        { code: 'SWD', name: 'ประตูบานสวิง' },
        { code: 'FXWD', name: 'ช่องแสงปิดตาย' },
        { code: 'SAWD', name: 'หน้าต่างบานยก' },
        { code: 'LVWD', name: 'หน้าต่างบานเกล็ด' },
        { code: 'FDD', name: 'ประตูบานเฟี้ยม' },
        { code: 'FDWD', name: 'หน้าต่างบานเฟี้ยม' }
    ];

    const panels = Array.from({ length: 10 }, (_, index) => ({
        count: index + 1,
        code: `${index + 1}P`
    }));

    const dimensions = Array.from({ length: 27 }, (_, index) => {
        const size = 40 + (index * 10);
        return { size, code: String(size / 10).padStart(2, '0') };
    });

    const frameColors = [
        { code: 'B', name: 'ดำ' },
        { code: 'W', name: 'ขาว' },
        { code: 'GS', name: 'เทาซาฮาร่า' },
        { code: 'AG', name: 'แอชเทคเกรย์' },
        { code: 'W1', name: 'ลายไม้1' },
        { code: 'W2', name: 'ลายไม้2' },
        { code: 'W3', name: 'ลายไม้3' },
        { code: 'W4', name: 'ลายไม้4' },
        { code: 'W5', name: 'ลายไม้5' },
        { code: 'W6', name: 'ลายไม้6' },
        { code: 'EF', name: 'กรอบสีอื่นๆ' }
    ];

    const glassColors = [
        { code: 'C', name: 'ใส' },
        { code: 'G', name: 'เขียว' },
        { code: 'B', name: 'ชาดำ' },
        { code: 'F', name: 'ฝ้า' },
        { code: 'LG', name: 'ลอนแก้ว' },
        { code: 'EG', name: 'กระจกสีอื่นๆ' }
    ];

    const netOptions = [
        { code: 'N', name: 'มีมุ้ง' },
        { code: 'X', name: 'ไม่มีมุ้ง' }
    ];

    const patterns = Array.from({ length: 26 }, (_, index) => ({
        dbCode: String(index),
        skuCode: `L${index}`,
        name: index === 0 ? 'ไม่มีลาย' : (index === 6 ? 'ลายกริด' : `ลาย${index}`)
    }));

    function findByCode(items, code) {
        const normalized = String(code || '').trim().toUpperCase();
        return items.find(item => item.code === normalized) || null;
    }

    function getDimension(value) {
        const numeric = Number(value);
        return dimensions.find(item => item.size === numeric || item.code === String(value)) || null;
    }

    function getPattern(value) {
        const normalized = String(value ?? '').trim().toUpperCase();
        if (normalized === 'X1') return patterns[6];
        const dbCode = normalized.replace(/^L/, '');
        return patterns.find(item => item.dbCode === dbCode) || null;
    }

    function buildProductCode(parts) {
        const type = findByCode(productTypes, parts.productType);
        const panel = panels.find(item => item.count === Number(parts.panelCount));
        const height = getDimension(parts.height);
        const width = getDimension(parts.width);
        const frame = findByCode(frameColors, parts.frameColor);
        const glass = findByCode(glassColors, parts.glassColor);
        const net = findByCode(netOptions, parts.net);
        const pattern = getPattern(parts.pattern);
        if (![type, panel, height, width, frame, glass, net, pattern].every(Boolean)) return '';
        return `${type.code}${panel.code}${height.code}${width.code}${frame.code}${glass.code}${net.code}${pattern.skuCode}`;
    }

    function parseProductCode(productCode) {
        const code = String(productCode || '').trim().toUpperCase();
        const prefixes = productTypes
            .flatMap(type => panels.map(panel => ({ type, panel, value: `${type.code}${panel.code}` })))
            .sort((a, b) => b.value.length - a.value.length);
        const prefix = prefixes.find(item => code.startsWith(item.value));
        if (!prefix) return null;

        let rest = code.slice(prefix.value.length);
        const height = dimensions.find(item => item.code === rest.slice(0, 2));
        const width = dimensions.find(item => item.code === rest.slice(2, 4));
        if (!height || !width) return null;
        rest = rest.slice(4);

        const frame = frameColors.slice().sort((a, b) => b.code.length - a.code.length).find(item => rest.startsWith(item.code));
        if (!frame) return null;
        rest = rest.slice(frame.code.length);

        const glass = glassColors.slice().sort((a, b) => b.code.length - a.code.length).find(item => rest.startsWith(item.code));
        if (!glass) return null;
        rest = rest.slice(glass.code.length);

        const net = findByCode(netOptions, rest.slice(0, 1));
        const pattern = getPattern(rest.slice(1));
        if (!net || !pattern || `${net.code}${pattern.skuCode}` !== rest) return null;

        return {
            productCode: code,
            productType: prefix.type.code,
            productTypeName: prefix.type.name,
            productPrefix: prefix.value,
            panelCount: prefix.panel.count,
            height: height.size,
            heightCode: height.code,
            width: width.size,
            widthCode: width.code,
            frameColor: frame.code,
            frameColorName: frame.name,
            glassColor: glass.code,
            glassColorName: glass.name,
            net: net.code,
            netName: net.name,
            patternCode: pattern.dbCode,
            patternSkuCode: pattern.skuCode,
            patternName: pattern.name,
            size: `${height.size}x${width.size}`
        };
    }

    function buildProductName(parts) {
        const parsed = typeof parts === 'string'
            ? parseProductCode(parts)
            : parseProductCode(buildProductCode(parts));
        if (!parsed) return '';
        return [
            parsed.productTypeName,
            `${parsed.panelCount} บาน`,
            `ขนาด ${parsed.size}`,
            `กรอบ${parsed.frameColorName}`,
            `กระจก${parsed.glassColorName}`,
            parsed.netName,
            parsed.patternName
        ].join(' ');
    }

    global.SKU_REFERENCE = Object.freeze({
        productTypes,
        panels,
        dimensions,
        frameColors,
        glassColors,
        netOptions,
        patterns,
        getDimension,
        getPattern,
        buildProductCode,
        parseProductCode,
        buildProductName
    });
})(window);
