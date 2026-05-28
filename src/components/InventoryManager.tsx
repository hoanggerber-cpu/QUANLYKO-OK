import React, { useState, useMemo } from 'react';
import { Product, ProductSource } from '../types';
import { 
  Plus, 
  Search, 
  Layers, 
  ShoppingBag, 
  ShieldAlert, 
  BadgeCheck, 
  FileCheck2, 
  Upload, 
  ImageIcon, 
  Eye,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2
} from 'lucide-react';
import { supabase, StorageManager } from '../lib/storage';

const isUnsplashUrl = (url: string | undefined): boolean => {
  if (!url) return true;
  return url.includes('unsplash.com') || url.includes('via.placeholder');
};

const getHexFromColorName = (colorName: string): string => {
  const norm = colorName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (norm.includes('den') || norm.includes('black')) return '#1e293b'; 
  if (norm.includes('trang') || norm.includes('white')) return '#f8fafc'; 
  if (norm.includes('do') || norm.includes('red')) return '#ef4444'; 
  if (norm.includes('navy') || norm.includes('xanh duong') || norm.includes('xanh bien') || norm.includes('blue')) return '#1d4ed8'; 
  if (norm.includes('xanh la') || norm.includes('green')) return '#10b981'; 
  if (norm.includes('xanh')) return '#3b82f6'; 
  if (norm.includes('vang') || norm.includes('yellow')) return '#fbbf24'; 
  if (norm.includes('cam') || norm.includes('orange')) return '#f97316'; 
  if (norm.includes('xam') || norm.includes('gray') || norm.includes('grey')) return '#94a3b8'; 
  if (norm.includes('hong') || norm.includes('pink')) return '#ec4899'; 
  if (norm.includes('tim') || norm.includes('purple') || norm.includes('violet')) return '#8b5cf6'; 
  if (norm.includes('nau') || norm.includes('brown')) return '#78350f'; 
  return '#475569'; 
};

interface TshirtIconSVGProps {
  colorName: string;
  strokeColor?: string;
  className?: string;
}

const TshirtIconSVG = ({ colorName, strokeColor = '#475569', className = 'w-10 h-10' }: TshirtIconSVGProps) => {
  const colorHex = getHexFromColorName(colorName);
  const borderHex = colorHex === '#f8fafc' ? '#94a3b8' : strokeColor;
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M32 15 C38 18 62 18 68 15 L88 23 L78 45 L70 42 V85 H30 V42 L22 45 L12 23 Z"
        fill={colorHex}
        stroke={borderHex}
        strokeWidth="4.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M44 15 C46 11 54 11 56 15" stroke={borderHex} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
};

interface InventoryManagerProps {
  products: Product[];
  onAddProduct: (product: Omit<Product, 'id' | 'createdAt'>) => void;
  onUpdateProduct?: (id: string, updatedFields: Partial<Product>) => any;
  onDeleteProduct?: (id: string) => void;
}

export default function InventoryManager({ products, onAddProduct, onUpdateProduct, onDeleteProduct }: InventoryManagerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Autocomplete suggestions state
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Edit/Delete Modal states
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editSize, setEditSize] = useState('L');
  const [editIsCustomSize, setEditIsCustomSize] = useState(false);
  const [editStock, setEditStock] = useState(1);
  const [editImportPrice, setEditImportPrice] = useState(50000);
  const [editSalePrice, setEditSalePrice] = useState(100000);
  const [editSource, setEditSource] = useState<ProductSource>('self_produced');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editUploading, setEditUploading] = useState(false);
  const [showEditSuggestions, setShowEditSuggestions] = useState(false);

  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [size, setSize] = useState('L');
  const [stock, setStock] = useState(1);
  const [importPrice, setImportPrice] = useState(50000);
  const [salePrice, setSalePrice] = useState(100000);
  const [source, setSource] = useState<ProductSource>('self_produced');
  
  // Real Image Uploading states
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const formatVND = (num: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
  };

  // Get unique existing product names for Autocomplete suggestions
  const existingNames = useMemo(() => {
    const list = products.map(p => p.name.trim());
    return Array.from(new Set(list));
  }, [products]);

  const suggestions = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return [];
    return existingNames.filter(ex => 
      ex.toLowerCase().includes(trimmed.toLowerCase()) &&
      ex.toLowerCase() !== trimmed.toLowerCase()
    );
  }, [name, existingNames]);

  const editSuggestions = useMemo(() => {
    const trimmed = editName.trim();
    if (!trimmed) return [];
    return existingNames.filter(ex => 
      ex.toLowerCase().includes(trimmed.toLowerCase()) &&
      ex.toLowerCase() !== trimmed.toLowerCase()
    );
  }, [editName, existingNames]);

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.color.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.size && p.size.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Grouping helper reactive memo - GROUP TRULY BY TÊN (Name) ONLY
  const groupedProducts = useMemo(() => {
    const groups: Record<string, {
      key: string; // represent unique key (lowercase name)
      name: string;
      image: string;
      source: ProductSource;
      colors: string[];
      sizes: string[];
      totalStock: number;
      minPrice: number;
      maxPrice: number;
      minImportPrice: number;
      maxImportPrice: number;
      items: Product[];
    }> = {};

    filtered.forEach(p => {
      const trimmedNameLower = p.name.trim().toLowerCase();
      if (!groups[trimmedNameLower]) {
        groups[trimmedNameLower] = {
          key: trimmedNameLower,
          name: p.name.trim(), // keep formatted name
          image: p.image,
          source: p.source,
          colors: [],
          sizes: [],
          totalStock: 0,
          minPrice: p.salePrice,
          maxPrice: p.salePrice,
          minImportPrice: p.importPrice,
          maxImportPrice: p.importPrice,
          items: []
        };
      }
      
      const g = groups[trimmedNameLower];
      g.totalStock += p.stock;
      g.items.push(p);

      if (!g.colors.includes(p.color)) {
        g.colors.push(p.color);
      }
      if (p.size && !g.sizes.includes(p.size)) {
        g.sizes.push(p.size);
      }
      
      // Select first non-empty design image if possible
      if (!g.image && p.image) {
        g.image = p.image;
      }
      
      if (p.salePrice < g.minPrice) g.minPrice = p.salePrice;
      if (p.salePrice > g.maxPrice) g.maxPrice = p.salePrice;
      if (p.importPrice < g.minImportPrice) g.minImportPrice = p.importPrice;
      if (p.importPrice > g.maxImportPrice) g.maxImportPrice = p.importPrice;
    });

    return Object.values(groups);
  }, [filtered]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    // FileReader base64 preview immediately
    const reader = new FileReader();
    reader.onloadend = () => {
      setImageUrl(reader.result as string);
      setUploading(false);
    };
    reader.readAsDataURL(file);

    // Sync to Supabase Storage if active
    const isActive = StorageManager.getIsSupabaseActive();
    if (isActive) {
      try {
        const fileExt = file.name.split('.').pop();
        const randId = Math.random().toString(36).substring(2, 11);
        const fileName = `factory_${randId}_${Date.now()}.${fileExt}`;
        const filePath = `originals/${fileName}`;

        const { data, error } = await supabase.storage
          .from('order-images')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.warn('Supabase storage upload failed:', error.message);
        } else if (data) {
          const { data: publicUrlData } = supabase.storage
            .from('order-images')
            .getPublicUrl(filePath);
          
          if (publicUrlData?.publicUrl) {
            setImageUrl(publicUrlData.publicUrl);
          }
        }
      } catch (err) {
        console.error('Uploading product design image failed:', err);
      }
    }
  };

  const handleEditImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEditUploading(true);

    const reader = new FileReader();
    reader.onloadend = () => {
      setEditImageUrl(reader.result as string);
      setEditUploading(false);
    };
    reader.readAsDataURL(file);

    const isActive = StorageManager.getIsSupabaseActive();
    if (isActive) {
      try {
        const fileExt = file.name.split('.').pop();
        const randId = Math.random().toString(36).substring(2, 11);
        const fileName = `factory_${randId}_${Date.now()}.${fileExt}`;
        const filePath = `originals/${fileName}`;

        const { data, error } = await supabase.storage
          .from('order-images')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.warn('Supabase storage upload failed:', error.message);
        } else if (data) {
          const { data: publicUrlData } = supabase.storage
            .from('order-images')
            .getPublicUrl(filePath);
          
          if (publicUrlData?.publicUrl) {
            setEditImageUrl(publicUrlData.publicUrl);
          }
        }
      } catch (err) {
        console.error('Uploading product design image failed:', err);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !color.trim()) return;

    const trimmedName = name.trim();
    const trimmedColor = color.trim();
    const trimmedSize = size.trim() || 'L';

    // Check if name already exists in a case-insensitive match
    const existingByName = products.find(
      p => p.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );

    // Standardize to existing name spelling to avoid duplicates
    const finalName = existingByName ? existingByName.name.trim() : trimmedName;

    // Check if EXACT match exists (same name, color, and size)
    const exactMatch = products.find(
      p => p.name.trim().toLowerCase() === finalName.toLowerCase() &&
           p.color.trim().toLowerCase() === trimmedColor.toLowerCase() &&
           (p.size || 'L').trim().toLowerCase() === trimmedSize.toLowerCase()
    );

    if (exactMatch) {
      // Automatic merge/gộp: increment stock and use newest prices and details
      if (onUpdateProduct) {
        onUpdateProduct(exactMatch.id, {
          stock: exactMatch.stock + Number(stock),
          importPrice: Number(importPrice),
          salePrice: Number(salePrice),
          image: imageUrl || exactMatch.image || '',
          source
        });
      }
    } else {
      // Add as a new item variant
      onAddProduct({
        name: finalName,
        color: trimmedColor,
        size: trimmedSize,
        stock: Number(stock),
        importPrice: Number(importPrice),
        salePrice: Number(salePrice),
        source,
        image: imageUrl || ''
      });
    }

    // Reset fields
    setName('');
    setColor('');
    setSize('L');
    setIsCustomSize(false);
    setStock(1);
    setImportPrice(50000);
    setSalePrice(100000);
    setSource('self_produced');
    setImageUrl('');
    setShowModal(false);
  };

  const handleEditClick = (prod: Product) => {
    setEditingProduct(prod);
    setEditName(prod.name);
    setEditColor(prod.color);
    setEditSize(prod.size || 'L');
    const isCustom = !['S', 'M', 'L', 'XL', 'XXL', '3XL', 'Freesize'].includes(prod.size || 'L');
    setEditIsCustomSize(isCustom);
    setEditStock(prod.stock);
    setEditImportPrice(prod.importPrice);
    setEditSalePrice(prod.salePrice);
    setEditSource(prod.source);
    setEditImageUrl(prod.image || '');
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    if (!editName.trim() || !editColor.trim()) return;

    if (onUpdateProduct) {
      try {
        await onUpdateProduct(editingProduct.id, {
          name: editName.trim(),
          color: editColor.trim(),
          size: editSize.trim() || 'L',
          stock: Number(editStock),
          importPrice: Number(editImportPrice),
          salePrice: Number(editSalePrice),
          source: editSource,
          image: editImageUrl
        });
        setEditingProduct(null);
      } catch (err) {
        console.error('Update product submit failed:', err);
      }
    } else {
      setEditingProduct(null);
    }
  };

  const handleDeleteClick = (prod: Product) => {
    setDeletingProduct(prod);
  };

  const handleDeleteConfirm = () => {
    if (deletingProduct && onDeleteProduct) {
      onDeleteProduct(deletingProduct.id);
    }
    setDeletingProduct(null);
  };

  return (
    <div className="space-y-6 animate-fade-in text-slate-700">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:max-w-md">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
            <Search className="w-5 h-5" />
          </span>
          <input
            type="text"
            placeholder="Tìm kiếm màu sắc, tên sản phẩm..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm shadow-sm"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/10 cursor-pointer whitespace-nowrap uppercase tracking-wide"
        >
          <Plus className="w-4 h-4" />
          <span>Thêm áo kho mới</span>
        </button>
      </div>

      {/* Grid view showing stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50/50 border border-blue-50 p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-blue-500 text-white rounded-xl">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Tổng sản phẩm</span>
            <span className="text-xl font-bold text-slate-800">{products.length} dòng</span>
          </div>
        </div>

        <div className="bg-emerald-50/50 border border-emerald-50 p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500 text-white rounded-xl">
            <BadgeCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Tổng số lượng kho</span>
            <span className="text-xl font-bold text-slate-800">
              {products.reduce((acc, curr) => acc + curr.stock, 0)} cái
            </span>
          </div>
        </div>

        <div className="bg-amber-50/50 border border-amber-50 p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-amber-500 text-white rounded-xl">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Báo cáo tồn kho thấp</span>
            <span className="text-xl font-bold text-amber-600">
              {products.filter(p => p.stock <= 10).length} mã hàng
            </span>
          </div>
        </div>
      </div>

      {/* Products Inventory List */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/40">
          <h3 className="font-bold text-slate-800">Cơ sở dữ liệu tồn kho sỉ lẻ (Xưởng may mặc sỉ)</h3>
          <span className="text-xs font-mono text-slate-400">Bấm vào bất cứ dòng nào để xổ ra chi tiết phân loại áo và màu sắc</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-4 px-6 text-center w-24">Hình đại diện</th>
                <th className="py-4 px-6">Tên mặt hàng sản phẩm</th>
                <th className="py-4 px-6">Tập hợp màu hiện có</th>
                <th className="py-4 px-6 text-center">Tổng lượng tồn kho</th>
                <th className="py-4 px-6 text-right">Khung giá nhập</th>
                <th className="py-4 px-6 text-right">Khung giá bán sỉ</th>
                <th className="py-4 px-6 text-center">Nguồn cung ứng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
              {groupedProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 font-medium">
                    Không tìm thấy sản phẩm nào trong kho thun trơn
                  </td>
                </tr>
              ) : (
                groupedProducts.map((group) => {
                  const isExpanded = !!expandedGroups[group.key];
                  const hasUnsplash = isUnsplashUrl(group.image);
                  return (
                    <React.Fragment key={group.key}>
                      <tr 
                        onClick={() => toggleGroup(group.key)}
                        className="hover:bg-blue-50/20 transition-all cursor-pointer border-b border-slate-100/80"
                      >
                        <td className="py-3 px-6 text-center select-none">
                          <div className="flex items-center gap-1.5 justify-center">
                            <span className="text-slate-450 mr-0.5">
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-blue-600 transition-transform" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-400 transition-transform" />
                              )}
                            </span>
                            
                            <div className="relative group overflow-hidden w-11 h-11 rounded-xl shadow-inner border border-slate-200 bg-slate-50 flex items-center justify-center">
                              {!hasUnsplash ? (
                                <>
                                  <img
                                    src={group.image}
                                    alt={group.name}
                                    className="w-full h-full object-cover transition-all"
                                    referrerPolicy="no-referrer"
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActivePreviewImage(group.image);
                                    }}
                                    className="absolute inset-0 bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-zoom-in"
                                    title="Phóng to ảnh xưởng"
                                  >
                                    <Eye className="w-4.5 h-4.5" />
                                  </button>
                                </>
                              ) : (
                                <TshirtIconSVG colorName={group.colors[0] || 'Blue'} className="w-8 h-8" />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-6 font-bold text-slate-800">
                          <div className="flex flex-col">
                            <span className="text-[15px]">{group.name}</span>
                            <span className="text-[10px] text-slate-450 font-mono font-bold mt-0.5 mt-1 text-blue-600">
                              ⚡ Chứa {group.items.length} mặt hàng chi tiết (Bấm để xem)
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-6">
                          <div className="flex flex-wrap gap-1">
                            {group.colors.map((color, cIdx) => (
                              <span key={cIdx} className="inline-flex items-center px-2 py-0.5 bg-slate-100 text-slate-750 rounded text-xs font-semibold">
                                {color}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-6 text-center font-black">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-extrabold ${
                            group.totalStock <= 10
                              ? 'bg-amber-100 text-amber-700 animate-pulse'
                              : 'bg-emerald-150 text-emerald-850'
                          }`}>
                            {group.totalStock} cái
                          </span>
                        </td>
                        <td className="py-3 px-6 text-right font-mono font-semibold text-slate-550">
                          {group.minImportPrice === group.maxImportPrice ? (
                            formatVND(group.minImportPrice)
                          ) : (
                            `${formatVND(group.minImportPrice)} - ${formatVND(group.maxImportPrice)}`
                          )}
                        </td>
                        <td className="py-3 px-6 text-right font-mono font-black text-blue-600">
                          {group.minPrice === group.maxPrice ? (
                            formatVND(group.minPrice)
                          ) : (
                            `${formatVND(group.minPrice)} - ${formatVND(group.maxPrice)}`
                          )}
                        </td>
                        <td className="py-3 px-6 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                            group.source === 'self_produced'
                              ? 'bg-blue-50 text-blue-700 border border-blue-100'
                              : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                          }`}>
                            {group.source === 'self_produced' ? (
                              <>
                                <Layers className="w-3 h-3" />
                                <span>Tự sản xuất</span>
                              </>
                            ) : (
                              <>
                                <FileCheck2 className="w-3 h-3" />
                                <span>Mua ngoài</span>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={7} className="p-4 pl-12 bg-slate-50/40 border-b border-slate-205">
                            <div className="bg-white rounded-xl border border-slate-200 p-4.5 shadow-sm animate-fade-in">
                              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                                <ShoppingBag className="w-4 h-4 text-blue-600" />
                                <span>Danh Sách Phân Loại Màu/Size & Thao tác Sửa Xóa của: {group.name}</span>
                              </h4>
                              
                              <div className="overflow-x-auto mt-2">
                                <table className="w-full text-left border-collapse border border-slate-100 rounded-xl overflow-hidden">
                                  <thead>
                                    <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-205">
                                      <th className="py-2.5 px-4 text-center w-16">Ảnh thật</th>
                                      <th className="py-2.5 px-4">Màu sắc</th>
                                      <th className="py-2.5 px-4 text-center">Size</th>
                                      <th className="py-2.5 px-4 text-center">S.Lượng tồn</th>
                                      <th className="py-2.5 px-4 text-right">Giá bán sỉ (VND)</th>
                                      <th className="py-2.5 px-4 text-right">Giá nhập (VND)</th>
                                      <th className="py-2.5 px-4 text-center">Nguồn cung</th>
                                      <th className="py-2.5 px-4 text-center">Thao tác</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 text-xs text-slate-650">
                                    {group.items.map((szPrd) => {
                                      const itemHasUnsplash = isUnsplashUrl(szPrd.image);
                                      return (
                                        <tr key={szPrd.id} className="hover:bg-slate-100/40 transition-colors">
                                          <td className="py-2.5 px-4 text-center">
                                            <div className="relative group overflow-hidden w-9 h-9 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center mx-auto">
                                              {!itemHasUnsplash ? (
                                                <>
                                                  <img
                                                    src={szPrd.image}
                                                    alt={szPrd.name}
                                                    className="w-full h-full object-cover"
                                                    referrerPolicy="no-referrer"
                                                  />
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setActivePreviewImage(szPrd.image);
                                                    }}
                                                    className="absolute inset-0 bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-zoom-in"
                                                  >
                                                    <Eye className="w-3.5 h-3.5" />
                                                  </button>
                                                </>
                                              ) : (
                                                <TshirtIconSVG colorName={szPrd.color} className="w-6 h-6" />
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2.5 px-4">
                                            <span className="font-bold text-slate-700">{szPrd.color}</span>
                                          </td>
                                          <td className="py-2.5 px-4 text-center">
                                            <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded font-black">{szPrd.size || 'L'}</span>
                                          </td>
                                          <td className="py-2.5 px-4 text-center font-bold">
                                            <span className={szPrd.stock <= 10 ? 'text-rose-600 font-extrabold animate-pulse' : 'text-slate-800'}>
                                              {szPrd.stock} cái
                                            </span>
                                          </td>
                                          <td className="py-2.5 px-4 text-right font-mono font-bold text-blue-650">
                                            {formatVND(szPrd.salePrice)}
                                          </td>
                                          <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                                            {formatVND(szPrd.importPrice)}
                                          </td>
                                          <td className="py-2.5 px-4 text-center">
                                            <span className="text-[10px] bg-slate-50 text-slate-600 px-2 py-0.5 rounded border border-slate-200/50">
                                              {szPrd.source === 'self_produced' ? 'Tự sản xuất' : 'Mua ngoài'}
                                            </span>
                                          </td>
                                          <td className="py-2.5 px-4 text-center">
                                            <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                              <button
                                                type="button"
                                                onClick={() => handleEditClick(szPrd)}
                                                className="p-1 px-2.5 bg-blue-50 hover:bg-blue-100 hover:text-blue-700 text-blue-600 rounded-md transition-all cursor-pointer font-bold inline-flex items-center gap-1"
                                                title="Sửa phân loại"
                                              >
                                                <Pencil className="w-3.5 h-3.5" />
                                                <span>Sửa</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleDeleteClick(szPrd)}
                                                className="p-1 px-2.5 bg-rose-50 hover:bg-rose-150 hover:text-rose-700 text-rose-600 rounded-md transition-all cursor-pointer font-bold inline-flex items-center gap-1"
                                                title="Xóa phân loại"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>Xóa</span>
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Product Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in text-slate-705">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-blue-900 text-white">
              <h3 className="font-bold text-lg">Khởi Tạo Sản Phẩm Áo Mới</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-white/80 hover:text-white cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 relative">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Tên sản phẩm áo thun (Yêu cầu)</label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Áo thun sỉ Luxury Cotton..."
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-semibold animate-fade-in"
                  />
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-[65] left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-50">
                      {suggestions.map((sug, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={() => {
                            setName(sug);
                            setShowSuggestions(false);
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-700 font-bold transition-colors cursor-pointer"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Màu sắc (Ví dụ: Đỏ Cam, Navy)</label>
                  <input
                    type="text"
                    required
                    placeholder="Màu sắc..."
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-bold"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Kích thước (Size)</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomSize(!isCustomSize);
                        setSize(isCustomSize ? 'L' : '');
                      }}
                      className="text-[11px] text-blue-600 hover:text-blue-700 font-bold underline cursor-pointer"
                    >
                      {isCustomSize ? 'Chọn theo S/M/L' : 'Nhập size khác'}
                    </button>
                  </div>
                  {isCustomSize ? (
                    <input
                      type="text"
                      required
                      placeholder="Ví dụ: 3XL, Freesize, Số 2,..."
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-bold"
                    />
                  ) : (
                    <select
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-bold text-slate-700 cursor-pointer"
                    >
                      <option value="S">S</option>
                      <option value="M">M</option>
                      <option value="L">L</option>
                      <option value="XL">XL</option>
                      <option value="XXL">XXL</option>
                      <option value="3XL">3XL</option>
                      <option value="Freesize">Freesize</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Số lượng nhập kho</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={stock}
                    onChange={(e) => setStock(Math.max(1, Number(e.target.value)))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Giá nhập kho (VND)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={importPrice}
                    onChange={(e) => setImportPrice(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-mono font-bold"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Giá bán niêm yết (VND)</label>
                  <input
                    type="number"
                    min="1000"
                    required
                    value={salePrice}
                    onChange={(e) => setSalePrice(Math.max(1000, Number(e.target.value)))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-mono font-bold"
                  />
                </div>

                {/* Direct factory real photo loader */}
                <div className="col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Ảnh thật vải / Phôi áo thực tế tại xưởng</label>
                  <div className="flex items-center gap-4.5 p-4 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-500/50 transition-all">
                    <div className="relative w-18 h-18 bg-white border border-slate-200/50 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                      {imageUrl && !isUnsplashUrl(imageUrl) ? (
                        <img src={imageUrl} alt="Tải lên" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <TshirtIconSVG colorName={color || 'Blue'} strokeColor="#94a3b8" className="w-12 h-12" />
                      )}
                    </div>

                    <div className="flex-1 space-y-1">
                      <span className="block text-xs font-bold text-slate-700">Tải tệp ảnh thật lên</span>
                      <span className="block text-[10px] text-slate-400">Các định dạng cho phép: JPEG, PNG, WEBP</span>
                      
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-150 text-blue-700 text-xs font-bold rounded-lg transition-colors cursor-pointer mt-1">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{uploading ? 'Đang tải...' : 'Chọn file ảnh'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageFileChange}
                          className="hidden"
                          disabled={uploading}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Mandatory Source radio selection */}
                <div className="col-span-2 bg-blue-50/40 p-4 rounded-xl border border-blue-50">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Phân loại nguồn hàng nhập (Bắt buộc chọn)</span>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="source"
                        value="self_produced"
                        checked={source === 'self_produced'}
                        onChange={() => setSource('self_produced')}
                        className="w-4.5 h-4.5 text-blue-600 border-slate-300 focus:ring-blue-550 focus:ring-1"
                      />
                      <span className="text-xs font-bold text-slate-700">Nhập kho hàng tự sản xuất</span>
                    </label>

                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="source"
                        value="external"
                        checked={source === 'external'}
                        onChange={() => setSource('external')}
                        className="w-4.5 h-4.5 text-blue-600 border-slate-300 focus:ring-blue-550 focus:ring-1"
                      />
                      <span className="text-xs font-bold text-slate-700">Nhập kho hàng mua đơn vị ngoài</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 hover:bg-slate-100 text-slate-500 font-semibold text-sm rounded-xl transition-all cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-blue-500/10 cursor-pointer disabled:opacity-50"
                >
                  Nhập kho sản phẩm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Click Lightbox Zoom Preview Modal */}
      {activePreviewImage && (
        <div 
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setActivePreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden flex flex-col items-center">
            <button
              onClick={() => setActivePreviewImage(null)}
              className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 text-white w-10 h-10 rounded-full flex items-center justify-center font-bold text-xl transition-all cursor-pointer shadow z-50 hover:scale-105"
            >
              &times;
            </button>
            <img
              src={activePreviewImage}
              alt="Zoom Product View"
              className="max-w-full max-h-[80vh] object-contain rounded-2xl border border-white/15 shadow-2xl animate-scale-in"
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="mt-4 bg-slate-900/95 text-white border border-slate-800 px-4 py-2 rounded-xl text-xs font-semibold shadow" onClick={(e) => e.stopPropagation()}>
              Bấm ra ngoài nền đen hoặc dấu X để đóng lightbox
            </div>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in text-slate-705">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-blue-900 text-white">
              <h3 className="font-bold text-lg">Chỉnh Sửa Chi Tiết Sản Phẩm</h3>
              <button
                onClick={() => setEditingProduct(null)}
                className="text-white/80 hover:text-white cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 relative">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Tên sản phẩm áo thun (Yêu cầu)</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      setShowEditSuggestions(true);
                    }}
                    onFocus={() => setShowEditSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowEditSuggestions(false), 200)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 font-semibold"
                  />
                  {showEditSuggestions && editSuggestions.length > 0 && (
                    <div className="absolute z-[65] left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-50">
                      {editSuggestions.map((sug, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={() => {
                            setEditName(sug);
                            setShowEditSuggestions(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 text-slate-700 font-bold transition-colors cursor-pointer"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Màu sắc</label>
                  <input
                    type="text"
                    required
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-bold"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Kích thước (Size)</label>
                    <button
                      type="button"
                      onClick={() => {
                        setEditIsCustomSize(!editIsCustomSize);
                        setEditSize(editIsCustomSize ? 'L' : '');
                      }}
                      className="text-[11px] text-blue-600 hover:text-blue-700 font-bold underline cursor-pointer"
                    >
                      {editIsCustomSize ? 'Chọn theo S/M/L' : 'Nhập size khác'}
                    </button>
                  </div>
                  {editIsCustomSize ? (
                    <input
                      type="text"
                      required
                      placeholder="Ví dụ: 3XL, Freesize, Số 2,..."
                      value={editSize}
                      onChange={(e) => setEditSize(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                    />
                  ) : (
                    <select
                      value={editSize}
                      onChange={(e) => setEditSize(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-750 cursor-pointer"
                    >
                      <option value="S">S</option>
                      <option value="M">M</option>
                      <option value="L">L</option>
                      <option value="XL">XL</option>
                      <option value="XXL">XXL</option>
                      <option value="3XL">3XL</option>
                      <option value="Freesize">Freesize</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Số lượng tồn kho</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editStock}
                    onChange={(e) => setEditStock(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Giá nhập (VND)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editImportPrice}
                    onChange={(e) => setEditImportPrice(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-sm"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Giá bán sỉ (VND)</label>
                  <input
                    type="number"
                    min="1000"
                    required
                    value={editSalePrice}
                    onChange={(e) => setEditSalePrice(Math.max(1000, Number(e.target.value)))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-sm"
                  />
                </div>

                {/* Edit Photo Loader */}
                <div className="col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Ảnh thật vải / Phôi áo thực tế</label>
                  <div className="flex items-center gap-4.5 p-4 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                    <div className="relative w-18 h-18 bg-white border border-slate-200/50 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                      {editImageUrl && !isUnsplashUrl(editImageUrl) ? (
                        <img src={editImageUrl} alt="Tải lên" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <TshirtIconSVG colorName={editColor || 'Blue'} strokeColor="#94a3b8" className="w-12 h-12" />
                      )}
                    </div>

                    <div className="flex-1 space-y-1">
                      <span className="block text-xs font-bold text-slate-700">Thay đổi ảnh sản phẩm</span>
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-150 text-blue-700 text-xs font-bold rounded-lg transition-colors cursor-pointer mt-1">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{editUploading ? 'Đang tải...' : 'Chọn file ảnh'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleEditImageFileChange}
                          className="hidden"
                          disabled={editUploading}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Edit Source */}
                <div className="col-span-2 bg-blue-50/40 p-4 rounded-xl border border-blue-50">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Phân loại nguồn hàng nhập</span>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="editSource"
                        value="self_produced"
                        checked={editSource === 'self_produced'}
                        onChange={() => setEditSource('self_produced')}
                        className="w-4.5 h-4.5 text-blue-600 border-slate-300 pointer-events-auto"
                      />
                      <span className="text-xs font-bold text-slate-700">Tự sản xuất</span>
                    </label>

                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="editSource"
                        value="external"
                        checked={editSource === 'external'}
                        onChange={() => setEditSource('external')}
                        className="w-4.5 h-4.5 text-blue-600 border-slate-300 pointer-events-auto"
                      />
                      <span className="text-xs font-bold text-slate-700">Mua ngoài</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 hover:bg-slate-100 text-slate-500 font-semibold text-sm rounded-xl cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={editUploading}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cập nhật phân loại
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingProduct && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-rose-100 flex items-center justify-between bg-rose-600 text-white">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-white animate-bounce" />
                <span>Xác nhận xóa phân loại kho</span>
              </h3>
              <button
                onClick={() => setDeletingProduct(null)}
                className="text-white hover:text-rose-100 cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm font-semibold text-slate-700">
                Bạn có chắc chắn muốn xóa vĩnh viễn phân loại sản phẩm sau khỏi hệ thống tồn kho?
              </p>
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-xs space-y-1 text-slate-800">
                <div className="flex justify-between font-bold">
                  <span>Yêu cầu xóa:</span>
                  <span className="text-rose-650">{deletingProduct.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Phân loại màu:</span>
                  <span className="font-bold text-slate-700">{deletingProduct.color}</span>
                </div>
                <div className="flex justify-between">
                  <span>Kích thước (Size):</span>
                  <span className="font-bold text-slate-755">{deletingProduct.size || 'L'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Số lượng còn lại:</span>
                  <span className="font-mono font-bold text-rose-600">{deletingProduct.stock} cái</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 italic">
                Lưu ý: Hành động này là vĩnh viễn và không thể khôi phục lại.
              </p>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 text-sm">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2 hover:bg-slate-200 text-slate-500 font-semibold rounded-xl cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl cursor-pointer"
              >
                Xác thực xóa phân loại
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
