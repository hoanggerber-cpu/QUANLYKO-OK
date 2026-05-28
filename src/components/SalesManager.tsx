// State khai báo để quản lý giá bán áo tuỳ chỉnh
const [customTshirtPrice, setCustomTshirtPrice] = useState<number>(100000);

// Đồng bộ hoá giá trị đề xuất ban đầu từ sản phẩm khi đổi dòng sản phẩm
useEffect(() => {
  if (selectedTshirtGroup) {
    const groupItems = products.filter(p => `${p.name} - Màu: ${p.color}` === selectedTshirtGroup);
    if (groupItems.length > 0) {
      setCustomTshirtPrice(groupItems[0].salePrice || 100000);
    }
  }
}, [selectedTshirtGroup, products]);

// ...

{/* Giao diện UI nằm trong tab Bán Áo thun Có Sẵn */}
<div className="space-y-4 animate-fade-in text-slate-750">
  {/* T-shirt Group Selection */}
  <div className="bg-blue-50/40 p-4 rounded-xl border border-blue-105 flex flex-col gap-2.5">
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
        Chọn mẫu mã & Màu sắc áo thun sỉ
      </label>
      <select
        value={selectedTshirtGroup}
        onChange={(e) => {
          setSelectedTshirtGroup(e.target.value);
          setTshirtSizesQty({});
        }}
        className="w-full px-3 py-2 bg-white border border-slate-205 rounded-xl text-sm focus:outline-none font-bold text-slate-800 shadow-sm cursor-pointer"
      >
        {tshirtGroups.map((g, gi) => (
          <option key={gi} value={g.key}>
            {g.name} - Màu: {g.color}
          </option>
        ))}
      </select>
    </div>

    {/* Thay thế Text giá tĩnh bằng Input nhập liệu tùy biến */}
    {selectedTshirtGroup && (
      <div className="flex flex-col gap-1.5 bg-white p-3 rounded-lg border border-slate-100">
        <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
          <span>Giá Bán Áo Thun (VND / Cái)</span>
          {activeGroupSizes[0]?.salePrice > 0 && (
            <button
              type="button"
              onClick={() => setCustomTshirtPrice(activeGroupSizes[0]?.salePrice || 100000)}
              className="text-[10px] text-blue-600 hover:underline cursor-pointer normal-case font-medium"
            >
              (Đặt lại về giá gốc: {formatCurrency(activeGroupSizes[0].salePrice)})
            </button>
          )}
        </div>
        <input
          type="number"
          min="0"
          placeholder="Nhập giá bán"
          value={customTshirtPrice || ''}
          onChange={(e) => setCustomTshirtPrice(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    )}
  </div>

  {/* Lưới nhập phân Size & Số lượng thực tế */}
  {selectedTshirtGroup && (
    <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200">
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
        Kiêm phân size & Nhập số lượng mua (Tồn kho thực tế)
      </label>
      <div className="divide-y divide-slate-200/60 max-h-48 overflow-y-auto pr-1">
        {activeGroupSizes.map((prod) => (
          <div key={prod.id} className="grid grid-cols-12 gap-2 py-2 items-center text-xs">
            <div className="col-span-3 font-extrabold text-slate-800 text-sm">
              Size {prod.size}
            </div>
            <div className="col-span-5 text-slate-500 font-medium">
              Tồn kho: <span className={`font-bold ${prod.stock <= 10 ? 'text-amber-600' : 'text-slate-700'}`}>{prod.stock} chiếc</span>
            </div>
            <div className="col-span-4 flex justify-end">
              <input
                type="number"
                min="0"
                max={prod.stock}
                placeholder="0"
                value={tshirtSizesQty[prod.id] || ''}
                onChange={(e) => {
                  let val = parseInt(e.target.value) || 0;
                  val = Math.min(prod.stock, Math.max(0, val));
                  setTshirtSizesQty(prev => ({ ...prev, [prod.id]: val }));
                }}
                className="w-18 px-2 py-1 bg-white border border-slate-300 rounded-lg text-center font-bold font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )}

  {/* Ảnh mẫu thiết kế đi kèm ... */}
  {/* Nút lưu sỉ áo thun vào giỏ hàng sử dụng customTshirtPrice */}
  <button
    type="button"
    onClick={handleAddTshirtsToCart}
    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold text-xs text-center rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/10 uppercase tracking-wider cursor-pointer border border-blue-700 mt-2.5 font-sans"
  >
    <Plus className="w-4 h-4" />
    <span>Thêm lô sỉ áo thun vào giỏ đơn</span>
  </button>
</div>
