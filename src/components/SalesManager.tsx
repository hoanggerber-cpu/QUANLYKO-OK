import React, { useState, useMemo, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { Order, Product, OrderType, OrderStatus, OrderItem } from '../types';
import { generateInvoicePDF, formatCurrency } from '../utils/pdfGenerator';
import { Search, Plus, Filter, FileText, Download, CheckCircle, Clock, Ban, ArrowUpRight, DollarSign, Upload, Image as ImageIcon, Eye, Calendar, Trash2, ShoppingBag, ChevronDown, ChevronUp, List, Layers, ChevronLeft, ChevronRight, ExternalLink, RotateCw, Sparkles, X } from 'lucide-react';
import { supabase, StorageManager } from '../lib/storage';

interface DtfItem {
  name: string;
  length: number;
  quantity: number;
  image?: string; // object URL or supabase public URL
  rawFile?: File;
}

const urlToFile = async (url: string, prefixName: string): Promise<File | null> => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const type = blob.type || 'image/png';
    const ext = type.split('/')[1] || 'png';
    return new File([blob], `${prefixName}_${Math.random().toString(36).substring(2, 11)}.${ext}`, { type });
  } catch (err) {
    console.warn('Failed to convert URL to file:', err);
    return null;
  }
};

interface SalesManagerProps {
  orders: Order[];
  products: Product[];
  onAddOrder: (order: Omit<Order, 'id' | 'orderCode'> & { createdAt?: string }) => void;
  onUpdateOrder: (id: string, updatedFields: Partial<Order>) => any;
  onDeleteOrder: (id: string) => void;
}

export default function SalesManager({ 
  orders, 
  products, 
  onAddOrder,
  onUpdateOrder,
  onDeleteOrder
}: SalesManagerProps) {
  const [activeTab, setActiveTab] = useState<OrderType>('dtf');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'cancelled'>('all');
  const [viewMode, setViewMode] = useState<'calendar' | 'flat' | 'grouped'>('calendar');
  
  // Custom Calendar stats and selection states
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    // Default to the month/date of the latest order if available, else current date
    if (orders && orders.length > 0) {
      const dates = orders.map(o => new Date(o.createdAt).getTime());
      const maxDate = new Date(Math.max(...dates));
      return maxDate;
    }
    return new Date();
  });
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Core Edit and Delete states for orders
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editPaidAmount, setEditPaidAmount] = useState(0);
  const [editPaidAmountStr, setEditPaidAmountStr] = useState('');
  const [editTotalPrice, setEditTotalPrice] = useState(0);
  const [editTotalPriceStr, setEditTotalPriceStr] = useState('');
  const [editQuantity, setEditQuantity] = useState(0);
  const [editQtyStr, setEditQtyStr] = useState('');
  const [editStatus, setEditStatus] = useState<OrderStatus>('pending');
  const [editCreatedAt, setEditCreatedAt] = useState('');
  const [editUnitPrice, setEditUnitPrice] = useState(0);
  const [editUnitPriceStr, setEditUnitPriceStr] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);

  const openEditOrder = (order: Order) => {
    let initialQuantity = order.quantity;
    if (order.type === 'dtf') {
      if (order.color) {
        const match = order.color.match(/(?:Độ dài|Đoạn)\s*([\d.]+)\s*m/i);
        if (match) {
          const parsedMeters = parseFloat(match[1]);
          if (!isNaN(parsedMeters) && parsedMeters > 0) {
            initialQuantity = parsedMeters;
          }
        }
      } else if (order.productName) {
        const match = order.productName.match(/In PET phim\s*\(([\d.]+)\s*m\)/i);
        if (match) {
          const parsedMeters = parseFloat(match[1]);
          if (!isNaN(parsedMeters) && parsedMeters > 0) {
            initialQuantity = parsedMeters;
          }
        }
      }
      
      if (initialQuantity === 1 && order.unitPrice > 0 && order.totalPrice > order.unitPrice) {
        const calcQty = order.totalPrice / order.unitPrice;
        initialQuantity = Number(calcQty.toFixed(2));
      }
    }

    setEditingOrder(order);
    setEditCustomerName(order.customerName);
    setEditPaidAmount(order.paidAmount);
    setEditPaidAmountStr(String(order.paidAmount));
    setEditTotalPrice(order.totalPrice);
    setEditTotalPriceStr(String(order.totalPrice));
    setEditQuantity(initialQuantity);
    setEditQtyStr(String(initialQuantity));
    setEditStatus(order.status);
    setEditCreatedAt(order.createdAt ? order.createdAt.substring(0, 10) : new Date().toISOString().substring(0, 10));
    setEditUnitPrice(order.unitPrice || 0);
    setEditUnitPriceStr(String(order.unitPrice || 0));
    setEditNotes(order.notes || '');
  };

  const handleEditOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    const finalQuantity = parseFloat(editQtyStr) || 0;
    const finalUnitPrice = parseFloat(editUnitPriceStr) || 0;
    const finalTotalPrice = parseFloat(editTotalPriceStr) || 0;
    const finalPaidAmount = Math.min(finalTotalPrice, parseFloat(editPaidAmountStr) || 0);
    const newDebtAmount = Math.max(0, finalTotalPrice - finalPaidAmount);
    
    // Automatically set status based on debt unless user chose 'cancelled'
    let finalStatus = editStatus;
    if (finalStatus !== 'cancelled') {
      finalStatus = newDebtAmount === 0 ? 'completed' : 'pending';
    }

    let finalProductName = editingOrder.productName;
    let finalColor = editingOrder.color || '';
    if (editingOrder.type === 'dtf') {
      finalProductName = `In PET phim (${finalQuantity.toFixed(1)}m)`;
      if (finalColor.includes('Độ dài')) {
        finalColor = `Độ dài ${finalQuantity.toFixed(2)}m`;
      } else if (finalColor.includes('Đoạn')) {
        finalColor = `Đoạn ${finalQuantity.toFixed(2)}m (SL:1)`;
      } else {
        finalColor = `Độ dài ${finalQuantity.toFixed(2)}m`;
      }
    } else if (editingOrder.type === 'tshirt') {
      if (/\(\d+\s*chiếc\)/i.test(finalProductName)) {
        finalProductName = finalProductName.replace(/\(\d+\s*chiếc\)/i, `(${Math.round(finalQuantity)} chiếc)`);
      } else {
        finalProductName = `${finalProductName.replace(/\s*\(\d+\s*chiếc\)/gi, '')} (${Math.round(finalQuantity)} chiếc)`;
      }
    }

    const updatedFields: Partial<Order> = {
      customerName: editCustomerName.trim(),
      productName: finalProductName,
      color: finalColor,
      quantity: finalQuantity,
      unitPrice: finalUnitPrice,
      totalPrice: finalTotalPrice,
      paidAmount: finalPaidAmount,
      debtAmount: newDebtAmount,
      status: finalStatus,
      notes: editNotes.trim()
    };

    if (editCreatedAt) {
      updatedFields.createdAt = new Date(editCreatedAt + 'T12:00:00.000Z').toISOString();
    }

    try {
      await onUpdateOrder(editingOrder.id, updatedFields);
      setEditingOrder(null);
      showToast('Đã cập nhật đơn hàng thành công!', 'success');
    } catch (err) {
      console.error('Update order submit failed:', err);
    }
  };

  const handleDeleteOrderConfirm = () => {
    if (!deletingOrder) return;
    onDeleteOrder(deletingOrder.id);
    setDeletingOrder(null);
    showToast('Đã xóa đơn hàng thành công!', 'success');
  };

  // Form states - client name and date
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Computed existing unique customer names
  const existingCustomerNames = useMemo(() => {
    const list = StorageManager.getCustomers();
    const uniqueNames = Array.from(new Set(list.map(c => c.name)));
    return uniqueNames;
  }, [orders]);

  const filteredCustomerSuggestions = useMemo(() => {
    if (!customerName.trim()) {
      return existingCustomerNames;
    }
    const searchLower = customerName.toLowerCase();
    return existingCustomerNames.filter(name => name.toLowerCase().includes(searchLower));
  }, [customerName, existingCustomerNames]);

  const [selectedProductType, setSelectedProductType] = useState<OrderType>('dtf');
  
  // Shopping Cart state
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  
  // Manual metrics DTF options
  const [isManualDtf, setIsManualDtf] = useState(false);
  const [manualDtfMeters, setManualDtfMeters] = useState(1.0);
  const [manualDtfImage, setManualDtfImage] = useState<string | undefined>(undefined);
  const [manualDtfFile, setManualDtfFile] = useState<File | undefined>(undefined);
  const [uploadingManualDtfImage, setUploadingManualDtfImage] = useState(false);

  // New T-shirt group selection and size-matrix state variables
  const [selectedTshirtGroup, setSelectedTshirtGroup] = useState<string>('');
  const [tshirtSizesQty, setTshirtSizesQty] = useState<Record<string, number>>({});
  const [tshirtPrintImage, setTshirtPrintImage] = useState<string | undefined>(undefined);
  const [tshirtPrintFile, setTshirtPrintFile] = useState<File | undefined>(undefined);
  const [uploadingTshirtPrintImage, setUploadingTshirtPrintImage] = useState(false);

  // For T-shirt ordering (legacy variables kept for compatibility where needed)
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(100000);
  
  // For Custom DTF ordering
  const [dtfItems, setDtfItems] = useState<DtfItem[]>([
    { name: 'Mẫu 1', length: 0.15, quantity: 1 }
  ]);
  const [dtfUnitPrice, setDtfUnitPrice] = useState<number>(55000); // suggest default 55000
  const [customDtfColor, setCustomDtfColor] = useState('Đa sắc (Full color)');

  // Payment states - defaulting to 'unpaid'
  const [paymentType, setPaymentType] = useState<'unpaid' | 'partial' | 'full'>('unpaid');
  const [paidAmount, setPaidAmount] = useState(0);

  // Custom date selection
  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
  const [lightboxRendering, setLightboxRendering] = useState<'smooth' | 'crisp'>('crisp');
  const [lightboxRotate, setLightboxRotate] = useState<number>(0);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [downloadingPNG, setDownloadingPNG] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info');

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  useEffect(() => {
    if (!showModal) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      let fileItem = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          fileItem = items[i];
          break;
        }
      }

      if (!fileItem) return;

      const file = fileItem.getAsFile();
      if (!file) return;

      // Prevent default browser paste behaviors
      e.preventDefault();

      showToast('Đang nhận hình ảnh từ clipboard...', 'info');

      if (selectedProductType === 'tshirt') {
        const objectUrl = URL.createObjectURL(file);
        setTshirtPrintImage(objectUrl);
        setTshirtPrintFile(file);

        // Upload to Supabase Storage
        const isOnline = StorageManager.getIsSupabaseActive();
        if (isOnline) {
          try {
            const fileExt = file.name ? file.name.split('.').pop() : 'png';
            const randId = Math.random().toString(36).substring(2, 11);
            const fileName = `paste_design_${randId}_${Date.now()}.${fileExt}`;
            const filePath = `originals/${fileName}`;

            const { data, error } = await supabase.storage
              .from('order-images')
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
              });

            if (error) {
              console.warn('Cannot upload pasted image to Supabase:', error.message);
            } else if (data) {
              const { data: publicUrlData } = supabase.storage
                .from('order-images')
                .getPublicUrl(filePath);
              
              if (publicUrlData?.publicUrl) {
                setTshirtPrintImage(publicUrlData.publicUrl);
                showToast('Dán và tải lên ảnh in áo thun thành công!', 'success');
              }
            }
          } catch (err) {
            console.error('Uploading pasted design failed:', err);
            showToast('Tải lên ảnh dán thất bại!', 'error');
          }
        } else {
          showToast('Đã dán ảnh (Lưu trữ tạm thời offline)', 'success');
        }

      } else if (selectedProductType === 'dtf') {
        if (isManualDtf) {
          const objectUrl = URL.createObjectURL(file);
          setManualDtfImage(objectUrl);
          setManualDtfFile(file);

          const isOnline = StorageManager.getIsSupabaseActive();
          if (isOnline) {
            try {
              const fileExt = file.name ? file.name.split('.').pop() : 'png';
              const randId = Math.random().toString(36).substring(2, 11);
              const fileName = `paste_manual_${randId}_${Date.now()}.${fileExt}`;
              const filePath = `originals/${fileName}`;

              const { data, error } = await supabase.storage
                .from('order-images')
                .upload(filePath, file, {
                  cacheControl: '3600',
                  upsert: false
                });

              if (error) {
                console.warn('Cannot upload pasted manual image to Supabase:', error.message);
              } else if (data) {
                const { data: publicUrlData } = supabase.storage
                  .from('order-images')
                  .getPublicUrl(filePath);
                
                if (publicUrlData?.publicUrl) {
                  setManualDtfImage(publicUrlData.publicUrl);
                  showToast('Dán và tải lên ảnh DTF thủ công thành công!', 'success');
                }
              }
            } catch (err) {
              console.error('Uploading pasted manual design failed:', err);
              showToast('Tải lên ảnh dán thất bại!', 'error');
            }
          } else {
            showToast('Đã dán ảnh (Lưu trữ tạm thời offline)', 'success');
          }

        } else {
          // Detailed patterns mode
          let targetIndex = dtfItems.length - 1;
          const lastItem = dtfItems[targetIndex];

          const designName = file.name ? file.name.replace(/\.[^/.]+$/, "") : `Mẫu ${dtfItems.length + 1}`;

          if (lastItem && !lastItem.image) {
            // Update last item
            handleUpdateDtfItem(targetIndex, 'name', designName);
            const objectUrl = URL.createObjectURL(file);
            handleUpdateDtfItem(targetIndex, 'image', objectUrl);
            handleUpdateDtfItem(targetIndex, 'rawFile', file);
          } else {
            // Add new pattern
            const newIndex = dtfItems.length;
            targetIndex = newIndex;
            const objectUrl = URL.createObjectURL(file);
            setDtfItems(prev => [...prev, { name: designName, length: 0.15, quantity: 1, image: objectUrl, rawFile: file }]);
          }

          const isOnline = StorageManager.getIsSupabaseActive();
          if (isOnline) {
            try {
              const fileExt = file.name ? file.name.split('.').pop() : 'png';
              const randId = Math.random().toString(36).substring(2, 11);
              const fileName = `paste_${randId}_${Date.now()}.${fileExt}`;
              const filePath = `originals/${fileName}`;

              const { data, error } = await supabase.storage
                .from('order-images')
                .upload(filePath, file, {
                  cacheControl: '3600',
                  upsert: false
                });

              if (error) {
                console.warn('Cannot upload pasted pattern image to Supabase:', error.message);
              } else if (data) {
                const { data: publicUrlData } = supabase.storage
                  .from('order-images')
                  .getPublicUrl(filePath);
                
                if (publicUrlData?.publicUrl) {
                  setDtfItems(prev => prev.map((item, i) => {
                    if (i === targetIndex) {
                      return { ...item, image: publicUrlData.publicUrl };
                    }
                    return item;
                  }));
                  showToast(`Dán và tải lên mẫu in #${targetIndex + 1} thành công!`, 'success');
                }
              }
            } catch (err) {
              console.error('Uploading pasted pattern failed:', err);
              showToast('Tải lên ảnh mẫu dán thất bại!', 'error');
            }
          } else {
            showToast(`Đã dán ảnh cho mẫu in #${targetIndex + 1} (Offline)`, 'success');
          }
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [showModal, selectedProductType, isManualDtf, dtfItems]);

  const handleManualDtfImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingManualDtfImage(true);
    const objectUrl = URL.createObjectURL(file);
    setManualDtfImage(objectUrl);
    setManualDtfFile(file);
    setUploadingManualDtfImage(false);

    const isOnline = StorageManager.getIsSupabaseActive();
    if (isOnline) {
      try {
        const fileExt = file.name.split('.').pop() || 'png';
        const randId = Math.random().toString(36).substring(2, 11);
        const fileName = `manual_${randId}_${Date.now()}.${fileExt}`;
        const filePath = `originals/${fileName}`;

        const { data, error } = await supabase.storage
          .from('order-images')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.warn('Cannot upload manual dtf to Supabase:', error.message);
        } else if (data) {
          const { data: publicUrlData } = supabase.storage
            .from('order-images')
            .getPublicUrl(filePath);
          
          if (publicUrlData?.publicUrl) {
            setManualDtfImage(publicUrlData.publicUrl);
          }
        }
      } catch (err) {
        console.error('Uploading manual design failed:', err);
      }
    }
  };

  // Custom addition of DTF items
  const handleAddDtfItem = () => {
    setDtfItems(prev => [...prev, { name: `Mẫu ${prev.length + 1}`, length: 0.15, quantity: 1 }]);
  };

  const handleTshirtPrintImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingTshirtPrintImage(true);
    const objectUrl = URL.createObjectURL(file);
    setTshirtPrintImage(objectUrl);
    setTshirtPrintFile(file);
    setUploadingTshirtPrintImage(false);

    const isOnline = StorageManager.getIsSupabaseActive();
    if (isOnline) {
      try {
        const fileExt = file.name.split('.').pop() || 'png';
        const randId = Math.random().toString(36).substring(2, 11);
        const fileName = `design_${randId}_${Date.now()}.${fileExt}`;
        const filePath = `originals/${fileName}`;

        const { data, error } = await supabase.storage
          .from('order-images')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.warn('Cannot upload to Supabase order-images:', error.message);
        } else if (data) {
          const { data: publicUrlData } = supabase.storage
            .from('order-images')
            .getPublicUrl(filePath);
          
          if (publicUrlData?.publicUrl) {
            setTshirtPrintImage(publicUrlData.publicUrl);
          }
        }
      } catch (err) {
        console.error('Uploading design failed:', err);
      }
    }
  };

  const handleRemoveDtfItem = (index: number) => {
    if (dtfItems.length > 1) {
      setDtfItems(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleUpdateDtfItem = (index: number, field: keyof DtfItem, value: any) => {
    setDtfItems(prev => prev.map((item, i) => {
      if (i === index) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  const handleImageUpload = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Set design name from file name
    const designName = file.name.replace(/\.[^/.]+$/, "");
    handleUpdateDtfItem(index, 'name', designName);

    // Read URL locally for premium responsiveness
    const objectUrl = URL.createObjectURL(file);
    handleUpdateDtfItem(index, 'image', objectUrl);
    handleUpdateDtfItem(index, 'rawFile', file);

    // Upload to Supabase Storage 'order-images' bucket
    const isOnline = StorageManager.getIsSupabaseActive();
    if (isOnline) {
      try {
        const fileExt = file.name.split('.').pop() || 'png';
        const randId = Math.random().toString(36).substring(2, 11);
        const fileName = `${randId}_${Date.now()}.${fileExt}`;
        const filePath = `originals/${fileName}`;

        const { data, error } = await supabase.storage
          .from('order-images')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.warn('Cannot upload to Supabase storage bucket order-images:', error.message);
        } else if (data) {
          const { data: publicUrlData } = supabase.storage
            .from('order-images')
            .getPublicUrl(filePath);
          
          if (publicUrlData?.publicUrl) {
            handleUpdateDtfItem(index, 'image', publicUrlData.publicUrl);
          }
        }
      } catch (err) {
        console.error('Supabase Storage Upload failed unexpectedly:', err);
      }
    }
  };

  // Derived T-shirt grouped properties
  const tshirtGroups = Array.from(
    new Set(products.map(p => `${p.name} - Màu: ${p.color}`))
  ).map(groupKey => {
    const groupItems = products.filter(p => `${p.name} - Màu: ${p.color}` === groupKey);
    return {
      key: groupKey,
      name: groupItems[0].name,
      color: groupItems[0].color,
      salePrice: groupItems[0].salePrice,
      image: groupItems[0].image
    };
  });

  const activeGroupSizes = products.filter(p => `${p.name} - Màu: ${p.color}` === selectedTshirtGroup);

  const getTshirtTotal = () => {
    return activeGroupSizes.reduce((acc, p) => acc + ((tshirtSizesQty[p.id] || 0) * p.salePrice), 0);
  };

  // Calculate total price reactively based on shopping cart
  const totalPrice = cartItems.reduce((acc, item) => acc + item.totalPrice, 0);

  const finalPaid = paymentType === 'full' 
    ? totalPrice 
    : paymentType === 'unpaid' 
    ? 0 
    : paidAmount;

  const debtAmount = totalPrice - finalPaid;

  const handleAddDtfToCart = () => {
    if (isManualDtf) {
      if (manualDtfMeters <= 0) {
        showToast('Vui lòng nhập chiều dài mét lớn hơn 0!', 'error');
        return;
      }
      const newItem: OrderItem = {
        id: 'ci_' + Math.random().toString(36).substring(2, 11),
        type: 'dtf',
        productName: 'In Phim PET DTF (Nhập mét tay)',
        color: `Độ dài ${manualDtfMeters.toFixed(2)}m`,
        quantity: manualDtfMeters,
        unitPrice: dtfUnitPrice,
        totalPrice: Number((manualDtfMeters * dtfUnitPrice).toFixed(0)),
        image: manualDtfImage,
        rawFile: manualDtfFile
      };
      setCartItems(prev => [...prev, newItem]);
      
      // Reset manual fields
      setManualDtfMeters(1.0);
      setManualDtfImage(undefined);
      setManualDtfFile(undefined);
    } else {
      if (dtfItems.length === 0) return;
      const itemsToAdd: OrderItem[] = [];
      for (const item of dtfItems) {
        if (item.length <= 0 || item.quantity <= 0) {
          showToast('Vui lòng nhập kích cỡ và số lượng mẫu in hợp lý!', 'error');
          return;
        }
        itemsToAdd.push({
          id: 'ci_' + Math.random().toString(36).substring(2, 11),
          type: 'dtf',
          productName: `In PET - ${item.name.trim() || 'Thiết kế mẫu'}`,
          color: `Đoạn ${item.length}m (SL:${item.quantity})`,
          quantity: Number((item.length * item.quantity).toFixed(2)),
          unitPrice: dtfUnitPrice,
          totalPrice: Number((item.length * item.quantity * dtfUnitPrice).toFixed(0)),
          image: item.image,
          rawFile: item.rawFile
        });
      }
      setCartItems(prev => [...prev, ...itemsToAdd]);
      
      // Reset list
      setDtfItems([{ name: 'Mẫu 1', length: 0.15, quantity: 1 }]);
    }
  };

  const handleAddTshirtsToCart = () => {
    const nonZeroSizes = activeGroupSizes.filter(p => (tshirtSizesQty[p.id] || 0) > 0);
    if (nonZeroSizes.length === 0) {
      showToast('Vui lòng nhập số lượng đặt mua cho ít nhất một Size!', 'error');
      return;
    }

    // Check stock limit
    for (const prod of nonZeroSizes) {
      const alreadyInCart = cartItems
        .filter(item => item.type === 'tshirt' && item.productName === prod.name && item.color.includes(`Size ${prod.size || 'N/A'}`))
        .reduce((sum, item) => sum + item.quantity, 0);

      const orderQty = tshirtSizesQty[prod.id] || 0;
      if (orderQty + alreadyInCart > prod.stock) {
        showToast(`Số lượng đặt mua (${orderQty + alreadyInCart}) của dòng Size ${prod.size} vượt quá hàng tồn trong kho (${prod.stock})!`, 'error');
        return;
      }
    }

    const itemsToAdd: OrderItem[] = nonZeroSizes.map(prod => ({
      id: 'ci_' + Math.random().toString(36).substring(2, 11),
      type: 'tshirt',
      productName: prod.name,
      color: `${prod.color} - Size ${prod.size || 'N/A'}`,
      size: prod.size,
      quantity: tshirtSizesQty[prod.id] || 0,
      unitPrice: prod.salePrice,
      totalPrice: (tshirtSizesQty[prod.id] || 0) * prod.salePrice,
      image: tshirtPrintImage,
      rawFile: tshirtPrintFile
    }));

    setCartItems(prev => [...prev, ...itemsToAdd]);

    // Reset quantities
    setTshirtSizesQty({});
    setTshirtPrintImage(undefined);
    setTshirtPrintFile(undefined);
  };

  const handleRemoveCartItem = (itemId: string) => {
    setCartItems(prev => prev.filter(i => i.id !== itemId));
  };

  const handleDownloadInvoicePNG = async () => {
    const invoiceEl = document.getElementById('mobile-invoice-receipt');
    if (!invoiceEl) return;
    try {
      setDownloadingPNG(true);
      const canvas = await html2canvas(invoiceEl, {
        useCORS: true,
        scale: 2.2,
        logging: false,
        backgroundColor: '#FCFCF9'
      });
      const link = document.createElement('a');
      link.download = `Hoa_Don_${previewOrder?.orderCode || 'Don_Hang'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Lỗi khi xuất ảnh hóa đơn:', err);
      showToast('Không thể tạo file ảnh, vui lòng chụp màn hình hoặc dùng bản PDF!', 'error');
    } finally {
      setDownloadingPNG(false);
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesTab = o.type === activeTab;
      const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
      const matchesSearch = !searchTerm ||
        o.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.orderCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.productName.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesTab && matchesStatus && matchesSearch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, activeTab, statusFilter, searchTerm]);

  // Group orders by date (LocaleDateString)
  const ordersGroupedByDate = useMemo(() => {
    const groups: { [key: string]: Order[] } = {};
    filteredOrders.forEach(order => {
      const dateKey = new Date(order.createdAt).toLocaleDateString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }); // returns DD/MM/YYYY
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(order);
    });
    return groups;
  }, [filteredOrders]);

  // Sort dates descending
  const sortedDateKeys = useMemo(() => {
    return Object.keys(ordersGroupedByDate).sort((a, b) => {
      const [dayA, monthA, yearA] = a.split('/').map(Number);
      const [dayB, monthB, yearB] = b.split('/').map(Number);
      return new Date(yearB, monthB - 1, dayB).getTime() - new Date(yearA, monthA - 1, dayA).getTime();
    });
  }, [ordersGroupedByDate]);

  const [expandedDateKeys, setExpandedDateKeys] = useState<{ [key: string]: boolean }>({});

  // Auto expand the latest/topmost date group
  useEffect(() => {
    if (sortedDateKeys.length > 0) {
      setExpandedDateKeys(prev => {
        if (Object.keys(prev).length === 0) {
          return { [sortedDateKeys[0]]: true };
        }
        return prev;
      });
    }
  }, [sortedDateKeys]);

  const toggleGroup = (key: string) => {
    setExpandedDateKeys(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Effect to auto-select the latest day with orders in the selected month/year
  useEffect(() => {
    if (viewMode === 'calendar') {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1; // 1-12
      const monthStr = month < 10 ? `0${month}` : `${month}`;
      
      // Filter sortedDateKeys to find ones matching MM/YYYY of current month
      const currentMonthKeys = sortedDateKeys.filter(key => key.endsWith(`/${monthStr}/${year}`));
      
      if (currentMonthKeys.length > 0) {
        if (!selectedDateKey || !currentMonthKeys.includes(selectedDateKey)) {
          setSelectedDateKey(currentMonthKeys[0]);
        }
      } else {
        setSelectedDateKey(null);
      }
    }
  }, [currentDate, sortedDateKeys, viewMode, selectedDateKey]);

  const tabOrders = useMemo(() => orders.filter(o => o.type === activeTab), [orders, activeTab]);
  const statusCounts = useMemo(() => {
    return {
      all: tabOrders.length,
      pending: tabOrders.filter(o => o.status === 'pending').length,
      completed: tabOrders.filter(o => o.status === 'completed').length,
      cancelled: tabOrders.filter(o => o.status === 'cancelled').length,
    };
  }, [tabOrders]);

  const activeStats = useMemo(() => {
    const list = filteredOrders;
    const totalRev = list.reduce((sum, o) => sum + o.totalPrice, 0);
    const totalPd = list.reduce((sum, o) => sum + o.paidAmount, 0);
    const totalDt = list.reduce((sum, o) => sum + o.debtAmount, 0);
    return { totalRev, totalPd, totalDt };
  }, [filteredOrders]);

  // Filter products that have stock for selecting
  const availableTshirtProducts = products.filter(p => p.stock > 0);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) return;
    if (cartItems.length === 0) {
      showToast('Vui lòng thêm ít nhất một sản phẩm vào Giỏ Hàng trước khi lưu hóa đơn!', 'error');
      return;
    }

    showToast('Đang xử lý dữ liệu và tải hình ảnh lên hệ thống...', 'info');

    // 1. Process cart items to upload raw files or images to Supabase Storage and strip any tail-end descriptions
    const cleanCartItems = await Promise.all(
      cartItems.map(async (item) => {
        let imageUrl = item.image;
        let fileToUpload = item.rawFile;

        // If there is no rawFile but we have a blob URL or image URL that is locally referenced (starts with "blob:" or "data:")
        // we can dynamically turn it into a File object.
        if (!fileToUpload && imageUrl && (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:'))) {
          const convertedFile = await urlToFile(imageUrl, 'item');
          if (convertedFile) {
            fileToUpload = convertedFile;
          }
        }

        // Upload the file if present and get its public storage URL
        if (fileToUpload) {
          try {
            const file = fileToUpload;
            const fileExt = file.name ? file.name.split('.').pop() || 'png' : 'png';
            const randId = Math.random().toString(36).substring(2, 11);
            const fileName = `item_${randId}_${Date.now()}.${fileExt}`;
            const filePath = `originals/${fileName}`;

            const { data, error } = await supabase.storage
              .from('order-images')
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
              });

            if (error) {
              console.warn('Cannot upload file of cart item to Supabase:', error.message);
            } else if (data) {
              const { data: publicUrlData } = supabase.storage
                .from('order-images')
                .getPublicUrl(filePath);

              if (publicUrlData?.publicUrl) {
                imageUrl = publicUrlData.publicUrl;
              }
            }
          } catch (uploadErr) {
            console.error('Error uploading item file during submit:', uploadErr);
          }
        }

        // Clean up text in color and product name
        const cleanColor = (item.color || '').replace(/\(Phân khúc nhập sỉ\)/gi, '').trim();
        const cleanProductName = (item.productName || '').replace(/\(Phân khúc nhập sỉ\)/gi, '').trim();

        return {
          ...item,
          productName: cleanProductName,
          color: cleanColor,
          image: imageUrl || undefined
        };
      })
    );

    // Synthesize billing configurations
    const firstType = cleanCartItems[0].type;
    const isMixed = cleanCartItems.some(i => i.type !== firstType);
    const finalType: OrderType = isMixed ? 'mixed' : firstType;

    // Synthesize general name
    const tshirtSum = cleanCartItems.filter(i => i.type === 'tshirt').reduce((sum, i) => sum + i.quantity, 0);
    const dtfSum = cleanCartItems.filter(i => i.type === 'dtf').reduce((sum, i) => sum + i.quantity, 0);

    const summaryParts: string[] = [];
    if (tshirtSum > 0) summaryParts.push(`Áo thun phôi (${tshirtSum} chiếc)`);
    if (dtfSum > 0) summaryParts.push(`In PET phim (${dtfSum.toFixed(1)}m)`);
    const finalProductName = summaryParts.join(' & ') || 'Đơn gộp tổng hợp';

    const finalColor = cleanCartItems
      .map(i => (i.color || '').split(' - ')[0])
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ')
      .replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')
      .trim();

    const finalQuantity = cleanCartItems.reduce((acc, item) => acc + item.quantity, 0);
    const finalUnitPrice = cleanCartItems[0]?.unitPrice || 0;

    const orderImagesUrl = cleanCartItems.map(item => item.image).filter(Boolean) as string[];
    const finalStatus: OrderStatus = finalPaid >= totalPrice ? 'completed' : 'pending';

    try {
      onAddOrder({
        customerName: customerName.trim(),
        type: finalType,
        productName: finalProductName,
        color: finalColor,
        quantity: finalQuantity,
        unitPrice: finalUnitPrice,
        totalPrice: totalPrice,
        paidAmount: finalPaid,
        debtAmount,
        status: finalStatus,
        createdAt: orderDate ? new Date(orderDate).toISOString() : new Date().toISOString(),
        orderImages: orderImagesUrl,
        items: cleanCartItems,
        notes: orderNotes.trim()
      });

      showToast('Lưu hóa đơn và ghi sổ thành công!', 'success');

      // Reset Form
      setCustomerName('');
      setOrderNotes('');
      setCartItems([]);
      setSelectedTshirtGroup('');
      setTshirtSizesQty({});
      setTshirtPrintImage(undefined);
      setIsManualDtf(false);
      setManualDtfMeters(1.0);
      setManualDtfImage(undefined);
      setPaymentType('unpaid');
      setPaidAmount(0);
      setDtfItems([{ name: 'Mẫu 1', length: 0.15, quantity: 1 }]);
      setDtfUnitPrice(55000);
      setOrderDate(new Date().toISOString().split('T')[0]);
      setShowModal(false);
    } catch (err: any) {
      console.error('Lỗi khi ghi sổ hóa đơn:', err);
      showToast(`Lỗi ghi sổ hóa đơn: ${err?.message || 'Lỗi cơ sở dữ liệu'}`, 'error');
    }
  };

  const handleOpenNewOrderModal = () => {
    setCartItems([]);
    setOrderNotes('');
    if (tshirtGroups.length > 0) {
      setSelectedTshirtGroup(tshirtGroups[0].key);
      setTshirtSizesQty({});
    }
    setTshirtPrintImage(undefined);
    setIsManualDtf(false);
    setManualDtfMeters(1.0);
    setManualDtfImage(undefined);
    setSelectedProductType(activeTab);
    
    // Default mode to unpaid
    setPaymentType('unpaid');
    setPaidAmount(0);
    
    // Reset to defaults
    setDtfItems([{ name: 'Mẫu 1', length: 0.15, quantity: 1 }]);
    setDtfUnitPrice(55000);
    setOrderDate(new Date().toISOString().split('T')[0]);
    setShowModal(true);
  };

  return (
    <div className="space-y-6 animate-fade-in text-slate-700">
      {/* Dynamic Header Badge and Action Area */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
            Hệ thống quản lý bán hàng
          </span>
          <h2 className="text-xl font-black text-slate-850 tracking-tight mt-1.5 flex items-center gap-2">
            <span>Danh Sách Đơn Giao Nhận & In Ấn</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Tổng cộng: <strong>{tabOrders.length}</strong> đơn hàng | Đang hiển thị bộ lọc: <strong>{statusFilter === 'all' ? 'Tất cả' : statusFilter === 'pending' ? 'Công nợ' : statusFilter === 'completed' ? 'Đã thu đủ' : 'Đã hủy'} ({filteredOrders.length})</strong>
          </p>
        </div>
        
        <button
          onClick={handleOpenNewOrderModal}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/15 cursor-pointer uppercase tracking-wider"
        >
          <Plus className="w-4.5 h-4.5" />
          <span>Tạo Đơn Hàng Mới</span>
        </button>
      </div>

      {/* Main Business Segment Filters */}
      <div className="bg-slate-100 p-1.5 rounded-2xl flex gap-1 border border-slate-200 shadow-inner w-fit">
        <button
          onClick={() => {
            setActiveTab('dtf');
          }}
          className={`px-6 py-2.5 font-black text-xs rounded-xl tracking-wider transition-all duration-150 uppercase cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'dtf'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-850'
          }`}
        >
          <span className="w-1.5 h-1.5 bg-blue-650 rounded-full"></span>
          Đơn hàng In Pet DTF ({orders.filter(o => o.type === 'dtf').length})
        </button>
        <button
          onClick={() => {
            setActiveTab('tshirt');
          }}
          className={`px-6 py-2.5 font-black text-xs rounded-xl tracking-wider transition-all duration-150 uppercase cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'tshirt'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-850'
          }`}
        >
          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
          Đơn hàng Áo thun ({orders.filter(o => o.type === 'tshirt').length})
        </button>
      </div>

      {/* Real-time statistics summaries */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4.5 rounded-2xl border border-slate-150/80 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Tổng Tiền Phát Sinh</span>
          <span className="text-xl font-black mt-2 font-mono text-slate-800">{formatCurrency(activeStats.totalRev)}</span>
          <span className="text-[9px] text-slate-400 block mt-1">Từ {filteredOrders.length} hóa đơn đang chọn</span>
        </div>

        <div className="bg-white p-4.5 rounded-2xl border border-slate-150/80 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Thống Kê Thực Thu</span>
          <span className="text-xl font-black mt-2 font-mono text-emerald-600">{formatCurrency(activeStats.totalPd)}</span>
          <span className="text-[9px] text-emerald-500 font-semibold block mt-1">Đã gạch nợ thành công</span>
        </div>

        <div className="bg-rose-50 border border-rose-100 p-4.5 rounded-2xl shadow-inner flex flex-col justify-between">
          <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest block">Tổng Dư Nợ Chưa Thu</span>
          <span className="text-xl font-black mt-2 font-mono text-rose-600">{formatCurrency(activeStats.totalDt)}</span>
          <span className="text-[9px] text-rose-450 block mt-1">
            {activeStats.totalDt > 0 ? '⚠️ Cần đôn đốc khách trả nợ' : '✅ Đã thu đủ sạch sẽ'}
          </span>
        </div>
      </div>

      {/* Advanced Filter, Search, and View Controls */}
      <div className="bg-white p-5 rounded-2xl border border-slate-150/85 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Filter Status Pills */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-50 hover:bg-slate-100/80 text-slate-600'
              }`}
            >
              <span>Tất cả</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${statusFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>
                {statusCounts.all}
              </span>
            </button>

            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'pending'
                  ? 'bg-amber-550 text-white shadow-xs'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/50'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Chưa thu hết (Còn Nợ)</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${statusFilter === 'pending' ? 'bg-white/25 text-white' : 'bg-amber-200'}`}>
                {statusCounts.pending}
              </span>
            </button>

            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'completed'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/50'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Đã thanh toán (Thu đủ)</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${statusFilter === 'completed' ? 'bg-white/25 text-white' : 'bg-emerald-200'}`}>
                {statusCounts.completed}
              </span>
            </button>

            <button
              onClick={() => setStatusFilter('cancelled')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'cancelled'
                  ? 'bg-slate-700 text-white shadow-xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
              }`}
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Hóa đơn đã Hủy</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${statusFilter === 'cancelled' ? 'bg-white/25 text-white' : 'bg-slate-200'}`}>
                {statusCounts.cancelled}
              </span>
            </button>
          </div>

          {/* Table display layout toggler */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 shadow-inner w-fit self-start lg:self-auto select-none">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                viewMode === 'calendar'
                  ? 'bg-white text-blue-700 shadow-sm border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              <span>Giao Diện Ô Lịch</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flat')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                viewMode === 'flat'
                  ? 'bg-white text-blue-700 shadow-sm border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Xem Dạng Bảng (Dễ Tìm)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                viewMode === 'grouped'
                  ? 'bg-white text-blue-700 shadow-sm border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Gộp Nhóm Ngày</span>
            </button>
          </div>

        </div>

        {/* Input Text Box Search */}
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
            <Search className="w-4.5 h-4.5" />
          </span>
          <input
            type="text"
            placeholder={`Gõ để tìm nhanh tên khách, mã hóa đơn (Vd: ORD-DTF-...) hoặc tên tóm tắt thiết kế mặt hàng ${activeTab === 'dtf' ? 'In Pet' : 'Áo thun'}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-500 transition-all text-sm font-semibold text-slate-800"
          />
        </div>
      </div>

      {/* Orders Output Group */}
      {viewMode === 'calendar' ? (() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth(); // 0-11
        
        // Day of week index for 1st of month: 0 (Sun), 1 (Mon), ..., 6 (Sat)
        const firstDayOfWeek = new Date(year, month, 1).getDay();
        // Adjust so Monday is 0, Tuesday is 1, ..., Sunday is 6
        const startDayOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        // We can gather all cells for the calendar grid
        const calendarCells: {
          day: number | null;
          dateString: string; // DD/MM/YYYY
          hasOrders: boolean;
          ordersCount: number;
          totalRevenue: number;
          hasPendingDebt: boolean;
          ordersList: Order[];
        }[] = [];
        
        // Previous Month's padding cells
        for (let i = 0; i < startDayOffset; i++) {
          calendarCells.push({
            day: null,
            dateString: '',
            hasOrders: false,
            ordersCount: 0,
            totalRevenue: 0,
            hasPendingDebt: false,
            ordersList: []
          });
        }
        
        // Current Month's cells (1 to daysInMonth)
        for (let day = 1; day <= daysInMonth; day++) {
          const dayStr = day < 10 ? `0${day}` : `${day}`;
          const mStr = (month + 1) < 10 ? `0${month + 1}` : `${month + 1}`;
          const cellDateKey = `${dayStr}/${mStr}/${year}`;
          
          // Find matching orders for this date Key
          const cellOrders = ordersGroupedByDate[cellDateKey] || [];
          const hasOrders = cellOrders.length > 0;
          const totalRev = cellOrders.reduce((sum, o) => sum + o.totalPrice, 0);
          const hasPendingDebt = cellOrders.some(o => o.status === 'pending');
          
          calendarCells.push({
            day,
            dateString: cellDateKey,
            hasOrders,
            ordersCount: cellOrders.length,
            totalRevenue: totalRev,
            hasPendingDebt,
            ordersList: cellOrders
          });
        }

        return (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-150/80 shadow-sm p-6 space-y-6 animate-fade-in text-slate-705">
              {/* Calendar Header: Month/Year navigation */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-5 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <Calendar className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-base">Xem Theo Lịch Ngày Trong Tháng</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Mỗi ô đại diện cho một ngày. Bấm chọn ngày để hiển thị chi tiết các đơn hàng phía dưới.</p>
                  </div>
                </div>

                {/* Navigation buttons */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentDate(prev => {
                        const nextDate = new Date(prev);
                        nextDate.setMonth(prev.getMonth() - 1);
                        return nextDate;
                      });
                    }}
                    className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer transition-colors"
                    title="Tháng trước"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  
                  <div className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm text-slate-850 select-none whitespace-nowrap min-w-[120px] text-center">
                    Tháng {String(month + 1).padStart(2, '0')} / {year}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentDate(prev => {
                        const nextDate = new Date(prev);
                        nextDate.setMonth(prev.getMonth() + 1);
                        return nextDate;
                      });
                    }}
                    className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer transition-colors"
                    title="Tháng sau"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Weekday headers: Monday to Sunday */}
              <div className="grid grid-cols-7 gap-2 text-center text-xs font-black text-slate-500 uppercase tracking-wider py-2 bg-slate-100 rounded-2xl select-none border border-slate-200/60 shadow-sm">
                <div>Thứ 2</div>
                <div>Thứ 3</div>
                <div>Thứ 4</div>
                <div>Thứ 5</div>
                <div>Thứ 6</div>
                <div>Thứ 7</div>
                <div className="text-rose-600">Chủ Nhật</div>
              </div>

              {/* Days Grid */}
              <div className="grid grid-cols-7 gap-3">
                {calendarCells.map((cell, index) => {
                  if (cell.day === null) {
                    return (
                      <div
                        key={`pad-${index}`}
                        className="min-h-[110px] rounded-[22px] bg-slate-100/50 border border-slate-200/40 shadow-inner"
                      />
                    );
                  }

                  const isSelected = selectedDateKey === cell.dateString;
                  
                  // Premium iOS App Icon-inspired styling for each day tile
                  let tileClasses = "";
                  let dayClasses = "";
                  let badgeClasses = "";
                  let priceClasses = "";
                  
                  if (cell.hasOrders) {
                    if (cell.hasPendingDebt) {
                      // iOS Style Amber-Orange-Rose Gradient (outstanding debt)
                      dayClasses = "text-white font-black text-base filter drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.2)]";
                      badgeClasses = "bg-white/95 text-rose-750 font-black px-2 py-0.5 rounded-lg text-[10px] shadow-sm";
                      priceClasses = "text-white font-black font-mono text-xs tracking-tight filter drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.2)]";
                      
                      if (isSelected) {
                        tileClasses = "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 border-4 border-slate-900 shadow-[0_15px_30px_rgba(249,115,22,0.45)] scale-[1.05] z-10 font-sans";
                      } else {
                        tileClasses = "bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 border border-amber-400/35 hover:border-amber-300 shadow-[0_6px_16px_rgba(249,115,22,0.22)] hover:shadow-[0_12px_24px_rgba(249,115,22,0.32)] hover:scale-[1.03] active:scale-95 font-sans";
                      }
                    } else {
                      // iOS Style Emerald-Teal Gradient (fully paid orders)
                      dayClasses = "text-white font-black text-base filter drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.2)]";
                      badgeClasses = "bg-white/95 text-emerald-850 font-black px-2 py-0.5 rounded-lg text-[10px] shadow-sm";
                      priceClasses = "text-white font-black font-mono text-xs tracking-tight filter drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.2)]";
                      
                      if (isSelected) {
                        tileClasses = "bg-gradient-to-br from-emerald-450 via-teal-500 to-cyan-600 border-4 border-slate-900 shadow-[0_15px_30px_rgba(16,185,129,0.45)] scale-[1.05] z-10 font-sans";
                      } else {
                        tileClasses = "bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 border border-emerald-400/35 hover:border-emerald-300 shadow-[0_6px_16px_rgba(16,185,129,0.22)] hover:shadow-[0_12px_24px_rgba(16,185,129,0.32)] hover:scale-[1.03] active:scale-95 font-sans";
                      }
                    }
                  } else {
                    // Empty date with classic modern framing
                    dayClasses = isSelected ? "text-slate-900 font-extrabold text-base" : "text-slate-500 font-bold text-sm";
                    badgeClasses = "bg-slate-100 text-slate-400 font-bold px-1.5 py-0.5 rounded-md text-[10px]";
                    priceClasses = isSelected ? "text-slate-500 font-bold text-[10px]" : "text-slate-350 font-medium text-[10px] italic";
                    
                    if (isSelected) {
                      tileClasses = "bg-slate-100 border-4 border-slate-900 shadow-[0_8px_20px_rgba(0,0,0,0.12)] scale-[1.03] z-10 font-sans";
                    } else {
                      tileClasses = "bg-white border border-slate-200 hover:border-blue-400 hover:shadow-sm hover:scale-[1.01] active:scale-95 text-slate-500 font-sans";
                    }
                  }

                  return (
                    <button
                      key={`cell-day-${cell.day}`}
                      type="button"
                      onClick={() => {
                        setSelectedDateKey(cell.dateString);
                      }}
                      className={`min-h-[115px] p-3.5 rounded-[22px] flex flex-col justify-between items-stretch text-left transition-all duration-150 relative cursor-pointer group select-none ${tileClasses}`}
                    >
                      {/* Day Number and dot indicator */}
                      <div className="flex justify-between items-start">
                        <span className={dayClasses}>
                          {cell.day}
                        </span>

                        {cell.hasOrders && (
                          <span className="flex h-3 w-3 relative">
                            {cell.hasPendingDebt ? (
                              <>
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-white border border-rose-500 shadow-xs" title="Còn nợ" />
                              </>
                            ) : (
                              <span className="relative inline-flex rounded-full h-3 w-3 bg-white border border-emerald-500 shadow-xs" title="Đã thu đủ" />
                            )}
                          </span>
                        )}
                      </div>

                      {/* Info lines */}
                      {cell.hasOrders ? (
                        <div className="mt-3.5 space-y-1.5 pointer-events-none">
                          <span className={badgeClasses}>
                            {cell.ordersCount} đơn
                          </span>
                          <div className={priceClasses}>
                            {formatCurrency(cell.totalRevenue).replace(/\s*đ/gi, '')}đ
                          </div>
                        </div>
                      ) : (
                        <div className="mt-5 pointer-events-none">
                          <span className="text-[9px] text-slate-350 font-semibold uppercase tracking-wider block">Trống</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Dynamic Color Legend resembling high quality index */}
              <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-5 border-t border-slate-100 text-xs font-bold text-slate-600">
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-2xl shadow-xs">
                  <div className="w-5 h-5 rounded-[7px] bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 shadow-md shadow-orange-550/20" />
                  <span>CÔNG NỢ (Chưa thu đủ)</span>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-2xl shadow-xs">
                  <div className="w-5 h-5 rounded-[7px] bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 shadow-md shadow-emerald-550/20" />
                  <span>THU ĐỦ (Đã sạch nợ)</span>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-2xl shadow-xs">
                  <div className="w-5 h-5 rounded-[7px] bg-white border border-slate-300 shadow-xs" />
                  <span>Không phát sinh đơn</span>
                </div>
              </div>
            </div>

            {/* Selection detail orders list */}
            <div className="animate-fade-in">
              {selectedDateKey ? (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4.5 rounded-2xl border border-slate-150 shadow-sm mt-2">
                    <div>
                      <h4 className="text-sm font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
                        <span>📅 Danh sách đơn ngày:</span>
                        <span className="text-blue-600 font-mono tracking-tight underline decoration-2">{selectedDateKey}</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-1">
                        Hiển thị các hóa đơn in ấn và may mặc và thông tin công nợ tương ứng của ngày {selectedDateKey}.
                      </p>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider w-fit">
                      Đang hiển thị
                    </span>
                  </div>

                  {!ordersGroupedByDate[selectedDateKey] || ordersGroupedByDate[selectedDateKey].length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-2xl text-sm text-slate-400 font-bold border border-slate-200 shadow-sm">
                      Không tìm thấy đơn hàng nào khớp với bộ lọc trong ngày này.
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl border border-slate-150 shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              <th className="py-4 px-5">Ghi chú / Mã đơn</th>
                              <th className="py-4 px-5">Tên Khách Hàng</th>
                              <th className="py-4 px-5">Chi Tiết Thiết Kế / Kích Thước</th>
                              <th className="py-4 px-3 text-center">S.Lượng</th>
                              <th className="py-4 px-3 text-right">Tổng Tiền</th>
                              <th className="py-4 px-3 text-right">Thực Thu</th>
                              <th className="py-4 px-3 text-right">Số Nợ</th>
                              <th className="py-4 px-4 text-center">Trạng Thái</th>
                              <th className="py-4 px-5 text-center">Hành Động</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-sm">
                            {ordersGroupedByDate[selectedDateKey].map((order) => (
                              <tr key={order.id} className="hover:bg-slate-50/40 transition-colors text-slate-650">
                                <td className="py-4 px-5">
                                  {order.notes ? (
                                    <div className="font-semibold text-slate-700 bg-slate-100 border border-slate-200/60 px-2 py-1 rounded-xl text-xs max-w-[170px] break-words whitespace-pre-wrap leading-snug animate-fade-in" title={order.notes}>
                                      {order.notes}
                                    </div>
                                  ) : (
                                    <span className="font-mono font-bold text-slate-400 text-xs">{order.orderCode}</span>
                                  )}
                                </td>
                                <td className="py-4 px-5 font-bold text-slate-900 whitespace-nowrap">
                                  {order.customerName}
                                </td>
                                <td className="py-4 px-5 max-w-xs whitespace-normal">
                                  <div className="space-y-1">
                                    <span className="text-slate-800 font-bold block leading-tight">{order.productName}</span>
                                    {order.color && (
                                      <span className="text-[11px] text-slate-400 font-semibold block">
                                        Màu sắc: {order.color.replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')}
                                      </span>
                                    )}
                                    {Array.isArray(order.orderImages) && order.orderImages.length > 0 && (
                                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                        {order.orderImages.map((img, imIdx) => (
                                          <img
                                            key={imIdx}
                                            src={img}
                                            alt="Thiết kế"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setActivePreviewImage(img);
                                            }}
                                            className="w-8 h-8 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:brightness-90 hover:scale-105 transition-all"
                                            referrerPolicy="no-referrer"
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="py-4 px-3 text-center font-bold text-slate-600">
                                  {order.quantity}
                                </td>
                                <td className="py-4 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                                  {formatCurrency(order.totalPrice)}
                                </td>
                                <td className="py-4 px-3 text-right font-mono text-emerald-600 font-bold whitespace-nowrap">
                                  {formatCurrency(order.paidAmount)}
                                </td>
                                <td className="py-4 px-3 text-right font-mono text-rose-600 font-extrabold whitespace-nowrap bg-rose-50/10">
                                  {formatCurrency(order.debtAmount)}
                                </td>
                                <td className="py-4 px-4 text-center whitespace-nowrap">
                                  {order.status === 'completed' ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full text-xs font-bold shadow-xs">
                                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>Đã thu đủ</span>
                                    </span>
                                  ) : order.status === 'pending' ? (
                                    <span className="inline-flex items-center gap-1 text-amber-805 bg-amber-100 px-2.5 py-1 rounded-full text-xs font-bold border border-amber-200/40">
                                      <Clock className="w-3.5 h-3.5 text-amber-600" />
                                      <span>Còn nợ</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-slate-550 bg-slate-105 px-2.5 py-1 rounded-full text-xs font-bold">
                                      <Ban className="w-3.5 h-3.5 text-slate-400" />
                                      <span>Đã hủy</span>
                                    </span>
                                  )}
                                </td>
                                <td className="py-4 px-5 text-center whitespace-nowrap">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewOrder(order)}
                                      className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-805 border border-amber-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                                      title="Hiển thị hóa đơn ảnh chia sẻ nhanh lên Zalo"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Xem 9:16</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => generateInvoicePDF(order)}
                                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                                      title="Tải tệp hóa đơn khách lẻ PDF khổ A5"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      <span>Tải PDF</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditOrder(order)}
                                      className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-850 border border-sky-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                                    >
                                      <span>Sửa</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeletingOrder(order)}
                                      className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-650 border border-rose-250 rounded-lg transition-colors cursor-pointer"
                                      title="Xóa vĩnh viễn hóa đơn"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-12 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-slate-400 font-semibold text-sm">
                  💡 Nhấp chuột chọn một ngày có đơn hàng trên lịch ở trên để xem chi tiết danh sách đơn và chỉnh sửa.
                </div>
              )}
            </div>
          </div>
        );
      })() : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center text-slate-400 font-semibold font-sans">
          Chưa tìm thấy đơn hàng nào khớp với điều kiện lọc đang chọn
        </div>
      ) : viewMode === 'flat' ? (
        /* Flat Sequential List Mode */
        <div className="bg-white rounded-2xl border border-slate-150/80 shadow-sm overflow-hidden animate-fade-in">
          <div className="px-6 py-4.5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <List className="w-4 h-4 text-blue-500" />
              <span>Danh Sách Đơn Hàng ({filteredOrders.length} hóa đơn)</span>
            </h3>
            <span className="text-[10px] bg-blue-55 text-blue-700 font-bold px-2 py-0.5 rounded uppercase tracking-wider">Mới nhất hiển thị ở đầu</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/55 border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-4 px-6">Ngày tạo</th>
                  <th className="py-4 px-6">Ghi chú / Mã đơn</th>
                  <th className="py-4 px-6">Tên Khách Hàng</th>
                  <th className="py-4 px-6">Chi Tiết Thiết Kế / Kích Thước</th>
                  <th className="py-4 px-3 text-center">S.Lượng</th>
                  <th className="py-4 px-3 text-right">Tổng Tiền</th>
                  <th className="py-4 px-3 text-right">Đã Thanh Toán</th>
                  <th className="py-4 px-3 text-right">Số Nợ</th>
                  <th className="py-4 px-4 text-center">Trạng Thái</th>
                  <th className="py-4 px-6 text-center">Hành Động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/44 transition-colors text-slate-650">
                    <td className="py-4 px-6 font-semibold text-slate-500 whitespace-nowrap">
                      {new Date(order.createdAt).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="py-4 px-6">
                      {order.notes ? (
                        <div className="font-semibold text-slate-700 bg-slate-100 border border-slate-200/60 px-2 py-1 rounded-xl text-xs max-w-[170px] break-words whitespace-pre-wrap leading-snug animate-fade-in" title={order.notes}>
                          {order.notes}
                        </div>
                      ) : (
                        <span className="font-mono font-bold text-slate-400 text-xs">{order.orderCode}</span>
                      )}
                    </td>
                    <td className="py-4 px-6 font-black text-slate-800 whitespace-nowrap">
                      {order.customerName}
                    </td>
                    <td className="py-4 px-6 max-w-xs whitespace-normal">
                      <div className="space-y-1">
                        <span className="text-slate-850 font-bold block leading-tight">{order.productName}</span>
                        {order.color && (
                          <span className="text-[11px] text-slate-400 font-semibold block">
                            Màu sắc: {order.color.replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')}
                          </span>
                        )}
                        {Array.isArray(order.orderImages) && order.orderImages.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {order.orderImages.map((img, imIdx) => (
                              <img
                                key={imIdx}
                                src={img}
                                alt="Thiết kế"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActivePreviewImage(img);
                                }}
                                className="w-8 h-8 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:brightness-90 hover:scale-105 transition-all"
                                referrerPolicy="no-referrer"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-3 text-center font-bold text-slate-600">
                      {order.quantity}
                    </td>
                    <td className="py-4 px-3 text-right font-mono font-bold text-slate-800">
                      {formatCurrency(order.totalPrice)}
                    </td>
                    <td className="py-4 px-3 text-right font-mono text-emerald-600 font-bold">
                      {formatCurrency(order.paidAmount)}
                    </td>
                    <td className="py-4 px-3 text-right font-mono text-rose-600 font-extrabold bg-rose-50/10">
                      {formatCurrency(order.debtAmount)}
                    </td>
                    <td className="py-4 px-4 text-center whitespace-nowrap">
                      {order.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full text-xs font-bold shadow-xs">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Đã thu đủ</span>
                        </span>
                      ) : order.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1 text-amber-805 bg-amber-100 px-2.5 py-1 rounded-full text-xs font-bold border border-amber-200/45">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>Còn nợ</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-550 bg-slate-105 px-2.5 py-1 rounded-full text-xs font-bold">
                          <Ban className="w-3.5 h-3.5 text-slate-400" />
                          <span>Đã hủy</span>
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPreviewOrder(order)}
                          className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-805 border border-amber-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                          title="Hiển thị hóa đơn ảnh chia sẻ nhanh lên Zalo"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Xem 9:16</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => generateInvoicePDF(order)}
                          className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                          title="Tải tệp hóa đơn khách lẻ PDF khổ A5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải PDF</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditOrder(order)}
                          className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                        >
                          <span>Sửa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingOrder(order)}
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-650 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                          title="Xóa vĩnh viễn hóa đơn"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Original Accordion Grouped View */
        <div className="space-y-4 font-sans text-slate-700">
          {sortedDateKeys.map(dateKey => {
            const dailyOrders = ordersGroupedByDate[dateKey];
            const isExpanded = !!expandedDateKeys[dateKey];
            const totalDailyRevenue = dailyOrders.reduce((sum, o) => sum + o.totalPrice, 0);
            const totalDailyQuantity = dailyOrders.reduce((sum, o) => sum + o.quantity, 0);

            return (
              <div key={dateKey} className="bg-white rounded-2xl border border-slate-150/80 shadow-sm overflow-hidden transition-all duration-200 animate-fade-in">
                {/* Accordion Trigger Header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(dateKey)}
                  className="w-full px-6 py-4 bg-slate-50 hover:bg-slate-100/70 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors text-left font-sans cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold font-sans">
                      <Calendar className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 tracking-tight group-hover:text-blue-700 transition-colors">
                        Ngày {dateKey}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Tổng cộng: <strong className="text-slate-600">{dailyOrders.length}</strong> đơn hàng | <strong className="text-slate-600">{totalDailyQuantity}</strong> sản phẩm giao nhận
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-auto">
                    <div className="text-right">
                      <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-bold">Chốt doanh thu</span>
                      <strong className="text-sm text-blue-600 font-mono font-extrabold block leading-none mt-1">
                        {formatCurrency(totalDailyRevenue)}
                      </strong>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-slate-150 text-slate-500 group-hover:text-slate-800 flex items-center justify-center transition-all border border-slate-200">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </button>

                {/* Collapsible Content */}
                {isExpanded && (
                  <div className="overflow-x-auto animate-fade-in bg-white">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-100">
                          <th className="py-3 px-6">Ghi chú / Mã đơn</th>
                          <th className="py-3 px-6">Tên khách hàng</th>
                          <th className="py-3 px-6">Chi tiết mặt hàng</th>
                          <th className="py-3 px-6 text-center">SL</th>
                          <th className="py-3 px-6 text-right">Tổng tiền</th>
                          <th className="py-3 px-6 text-right">Đã trả</th>
                          <th className="py-3 px-6 text-right">Còn nợ</th>
                          <th className="py-3 px-6 text-center">Trạng thái</th>
                          <th className="py-3 px-6 text-center">Hành động</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {dailyOrders.map((order) => (
                          <tr key={order.id} className="hover:bg-slate-50/30 transition-colors">
                            <td className="py-3.5 px-6">
                              {order.notes ? (
                                <div className="font-semibold text-slate-700 bg-slate-100 border border-slate-200/60 px-2 py-1 rounded-xl text-xs max-w-[170px] break-words whitespace-pre-wrap leading-snug animate-fade-in" title={order.notes}>
                                  {order.notes}
                                </div>
                              ) : (
                                <span className="font-mono font-bold text-slate-400 text-xs">{order.orderCode}</span>
                              )}
                            </td>
                            <td className="py-3.5 px-6 font-extrabold text-slate-800">{order.customerName}</td>
                            <td className="py-3.5 px-6 max-w-xs whitespace-normal" title={order.productName}>
                              <span className="text-slate-700 font-bold block leading-tight">{order.productName}</span>
                              <span className="text-[11px] text-slate-400 block mt-0.5">{(order.color || 'Mặc định').replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')}</span>
                              {Array.isArray(order.orderImages) && order.orderImages.length > 0 && (
                                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                  {order.orderImages.map((img, imIdx) => (
                                    <img
                                      key={imIdx}
                                      src={img}
                                      alt="Thiết kế"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActivePreviewImage(img);
                                      }}
                                      className="w-8 h-8 object-cover rounded-md border border-slate-200 shadow-sm cursor-zoom-in hover:brightness-90 hover:scale-105 transition-all"
                                      referrerPolicy="no-referrer"
                                    />
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-6 text-center font-bold text-slate-600">{order.quantity}</td>
                            <td className="py-3.5 px-6 text-right font-mono font-bold text-slate-900">
                              {formatCurrency(order.totalPrice)}
                            </td>
                            <td className="py-3.5 px-6 text-right font-mono text-emerald-600 font-bold">
                              {formatCurrency(order.paidAmount)}
                            </td>
                            <td className="py-3.5 px-6 text-right font-mono text-rose-600 font-extrabold bg-rose-50/10">
                              {formatCurrency(order.debtAmount)}
                            </td>
                            <td className="py-3.5 px-6 text-center whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500">
                                {order.status === 'completed' ? (
                                  <span className="text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" />
                                    <span>Đã thu đủ</span>
                                  </span>
                                ) : order.status === 'pending' ? (
                                  <span className="text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    <span>Còn nợ</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <Ban className="w-3 h-3" />
                                    <span>Đã hủy</span>
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="py-3.5 px-6 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setPreviewOrder(order)}
                                  title="Xem hóa đơn di động 9:16"
                                  className="p-1 px-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 hover:text-amber-850 transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold font-sans"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Xem 9:16</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => generateInvoicePDF(order)}
                                  title="Tải nhanh hóa đơn PDF"
                                  className="p-1 px-2 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg hover:bg-blue-100 hover:text-blue-700 transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-semibold"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>A5</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditOrder(order)}
                                  title="Sửa thông tin đơn hàng"
                                  className="p-1 px-2.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg hover:bg-sky-100 transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                                >
                                  <span>Sửa</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingOrder(order)}
                                  title="Xóa đơn hàng"
                                  className="p-1 px-2 bg-rose-50 text-rose-600 border border-rose-150 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Xóa</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Order Creation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-scale-in max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-blue-900 text-white">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-blue-200" />
                <h3 className="font-bold text-lg">Tạo Đơn Hàng Mới (Dạng Giỏ Hàng)</h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-white/80 hover:text-white cursor-pointer text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="flex-1 flex flex-col overflow-hidden">
              <div className="p-6 space-y-4 overflow-y-auto flex-1 text-slate-700">
                {/* Customer & Date details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50 shadow-sm">
                <div className="relative">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Tên khách hàng</label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      placeholder="Ví dụ: Đại lý In Trần Phú..."
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value);
                        setShowCustomerDropdown(true);
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      onBlur={() => {
                        setTimeout(() => setShowCustomerDropdown(false), 250);
                      }}
                      className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-semibold"
                    />
                    {customerName && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerName('');
                          setShowCustomerDropdown(true);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold hover:scale-110 duration-100 text-lg cursor-pointer"
                        title="Xóa nhanh"
                      >
                        &times;
                      </button>
                    )}
                  </div>

                  {showCustomerDropdown && (
                    <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-slate-100/70 animate-fade-in">
                      {filteredCustomerSuggestions.map((name, sIdx) => (
                        <button
                          key={sIdx}
                          type="button"
                          onMouseDown={() => {
                            setCustomerName(name);
                            setShowCustomerDropdown(false);
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-xs font-bold text-slate-700 block transition-colors cursor-pointer"
                        >
                          👤 {name}
                        </button>
                      ))}

                      {customerName.trim() && !existingCustomerNames.some(n => n.toLowerCase() === customerName.trim().toLowerCase()) && (
                        <button
                          type="button"
                          onMouseDown={() => {
                            setShowCustomerDropdown(false);
                          }}
                          className="w-full text-left px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-xs font-bold text-blue-700 block transition-colors cursor-pointer"
                        >
                          ✨ Thêm khách hàng mới: "{customerName}"
                        </button>
                      )}

                      {filteredCustomerSuggestions.length === 0 && !customerName.trim() && (
                        <div className="px-4 py-3 text-xs text-slate-400 font-medium text-center italic">
                          Chuyên biệt chưa có đối tác. Hãy gõ để tự động thêm!
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Ngày ghi sổ hóa đơn</label>
                  <div className="relative">
                    <input
                      type="date"
                      required
                      value={orderDate}
                      onChange={(e) => setOrderDate(e.target.value)}
                      className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-mono font-bold text-slate-700"
                    />
                  </div>
                </div>
              </div>

              {/* Product Category tab selector */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Loại sản phẩm thêm vào giỏ</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProductType('dtf');
                      setUnitPrice(150000);
                      setQuantity(1);
                    }}
                    className={`p-3 text-sm font-bold border rounded-xl cursor-pointer text-center ${
                      selectedProductType === 'dtf'
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    In Phim PET DTF
                  </button>
                  <button
                    type="button"
                    disabled={availableTshirtProducts.length === 0}
                    onClick={() => {
                      setSelectedProductType('tshirt');
                      if (tshirtGroups.length > 0 && !selectedTshirtGroup) {
                        setSelectedTshirtGroup(tshirtGroups[0].key);
                      }
                      setQuantity(1);
                    }}
                    className={`p-3 text-sm font-bold border rounded-xl cursor-pointer text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                      selectedProductType === 'tshirt'
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    Bán Áo thun Có Sẵn {availableTshirtProducts.length === 0 && '(Hết hàng)'}
                  </button>
                </div>
              </div>

              {/* Dynamic properties depending on DTF vs Tshirt */}
              {selectedProductType === 'dtf' ? (
                <div className="space-y-4">
                  {/* Unit price per 1 meter */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                        Đơn giá trên 1 Mét (VND)
                      </label>
                      <input
                        type="number"
                        required
                        min="1000"
                        value={dtfUnitPrice}
                        onChange={(e) => setDtfUnitPrice(Math.max(0, Number(e.target.value)))}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm focus:border-blue-500 transition-all font-mono font-bold text-slate-800"
                      />
                    </div>

                    <div className="flex flex-col justify-end">
                      <label className="inline-flex items-center gap-2 cursor-pointer bg-blue-50 hover:bg-blue-100 border border-blue-150 p-2.5 rounded-xl transition-all shadow-sm">
                        <input
                          type="checkbox"
                          checked={isManualDtf}
                          onChange={(e) => setIsManualDtf(e.target.checked)}
                          className="w-4.5 h-4.5 text-blue-600 rounded border-slate-300 pointer-events-auto"
                        />
                        <div className="text-left ml-2">
                          <span className="text-xs font-bold text-blue-800 block">Nhập tổng số Mét thủ công</span>
                          <span className="text-[10px] text-slate-400 block leading-none">Không cần chi tiết từng mẫu nhỏ</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {isManualDtf ? (
                    <div className="bg-blue-50/15 p-4 rounded-xl border border-blue-105 space-y-3.5 animate-slide-in">
                      <div>
                        <label className="block text-[11px] uppercase font-bold text-slate-500 mb-1 font-sans">Tổng chiều dài phim cần in (Mét)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="Ví dụ: 5.5"
                          value={manualDtfMeters <= 0 ? '' : manualDtfMeters}
                          onChange={(e) => setManualDtfMeters(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg text-sm font-mono font-bold focus:outline-none text-slate-800 shadow-sm"
                        />
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-inner">
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Hình gửi thi công (Maket / File gộp)</label>
                        <div className="flex items-center gap-4">
                          <div className="relative w-14 h-14 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                            {manualDtfImage ? (
                              <>
                                <img src={manualDtfImage} alt="Mẫu chụp" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                <button
                                  type="button"
                                  onClick={() => setManualDtfImage(undefined)}
                                  className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold"
                                >
                                  &times;
                                </button>
                              </>
                            ) : (
                              <ImageIcon className="w-6 h-6 text-slate-350" />
                            )}
                          </div>

                          <div className="flex-1 space-y-1">
                            <span className="block text-xs font-bold text-slate-700 leading-none">Tải ảnh sơ duyệt</span>
                            <label className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 hover:bg-blue-105 text-blue-600 text-[11px] font-bold rounded cursor-pointer transition-colors border border-blue-100">
                              <Upload className="w-3 h-3" />
                              <span>{uploadingManualDtfImage ? 'Đang tải...' : 'Chọn ảnh'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={handleManualDtfImageUpload}
                                className="hidden"
                                disabled={uploadingManualDtfImage}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* List of shapes/patterns */}
                  {!isManualDtf && (
                    <div className="space-y-3 bg-indigo-50/20 p-4 rounded-xl border border-indigo-100/50">
                      <div className="flex items-center justify-between border-b border-indigo-100/60 pb-2">
                        <span className="text-xs font-bold text-indigo-955 uppercase tracking-wider">Danh sách mẫu hình in</span>
                        <button
                          type="button"
                          onClick={handleAddDtfItem}
                          className="px-2.5 py-1.5 bg-blue-105 hover:bg-blue-200 text-blue-700 font-bold text-xs rounded-lg flex items-center gap-1 transition-colors cursor-pointer border border-blue-150 animate-fade-in"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Thêm mẫu in mới</span>
                        </button>
                      </div>

                    <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
                      {dtfItems.map((item, idx) => {
                        const itemMeters = item.length * item.quantity;
                        const itemPrice = itemMeters * dtfUnitPrice;
                        return (
                          <div key={idx} className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm relative group space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-400">Mẫu #{idx + 1}</span>
                              {dtfItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDtfItem(idx)}
                                  className="text-[11px] text-rose-500 hover:text-rose-700 font-bold cursor-pointer transition-colors"
                                >
                                  Xóa mẫu
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div className="sm:col-span-3">
                                <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Hình ảnh thiết kế mẫu in</label>
                                <div className="flex items-center gap-3 bg-slate-50 p-2 border border-slate-200/60 rounded-xl">
                                  {item.image ? (
                                    <div className="relative group flex-shrink-0">
                                      <img
                                        src={item.image}
                                        alt={item.name}
                                        onClick={() => setActivePreviewImage(item.image!)}
                                        className="w-12 h-12 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:brightness-95 transition-all"
                                        referrerPolicy="no-referrer"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateDtfItem(idx, 'image', undefined)}
                                        className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold cursor-pointer transition-colors shadow-sm"
                                        title="Xóa hình ảnh"
                                      >
                                        &times;
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 border border-dashed border-slate-200 flex-shrink-0">
                                      <ImageIcon className="w-5 h-5 opacity-55" />
                                    </div>
                                  )}

                                  <div className="flex-1 min-w-0">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      id={`dtf-file-img-${idx}`}
                                      className="hidden"
                                      onChange={(e) => handleImageUpload(idx, e)}
                                    />
                                    <div className="flex items-center gap-2">
                                      <label
                                        htmlFor={`dtf-file-img-${idx}`}
                                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-105 border border-blue-150 text-blue-680 font-bold text-[11px] rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 shadow-sm uppercase tracking-wider"
                                      >
                                        <Upload className="w-3 h-3" />
                                        <span>Upload Hình Ảnh</span>
                                      </label>
                                      {item.image && (
                                        <button
                                          type="button"
                                          onClick={() => setActivePreviewImage(item.image!)}
                                          className="p-1 px-2.5 bg-slate-100 text-slate-600 hover:text-slate-800 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1 border border-slate-200"
                                          title="Xem ảnh cỡ lớn"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                          <span>Xem ảnh</span>
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-1 truncate">
                                      Mẫu in: <span className="font-bold text-slate-600">{item.name || `Chưa tải ảnh (${idx + 1})`}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="sm:col-span-2">
                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Chiều dài (Mét)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  required
                                  value={item.length}
                                  onChange={(e) => handleUpdateDtfItem(idx, 'length', Math.max(0, parseFloat(e.target.value) || 0))}
                                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Số lượng</label>
                                <input
                                  type="number"
                                  min="1"
                                  required
                                  value={item.quantity}
                                  onChange={(e) => handleUpdateDtfItem(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold focus:outline-none"
                                />
                              </div>
                            </div>

                            <div className="pt-2 border-t border-dashed border-slate-100 flex items-center justify-between text-[11px] font-medium text-slate-500">
                              <div>
                                Số m mẫu: <span className="font-bold text-slate-850 font-mono">{itemMeters.toFixed(2)}m</span>
                              </div>
                              <div>
                                Thành tiền: <span className="font-bold text-blue-600 font-mono">{formatCurrency(itemPrice)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}
                  
                  {/* Universal DTF Add to Cart trigger */}
                  <button
                    type="button"
                    onClick={handleAddDtfToCart}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold text-xs text-center rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/10 uppercase tracking-wider cursor-pointer border border-blue-700 mt-2.5 font-sans"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Thêm lô PET DTF {isManualDtf ? `(${manualDtfMeters}m)` : ''} vào giỏ đơn</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4 animate-fade-in text-slate-750">
                  {/* T-shirt Group Selection */}
                  <div className="bg-blue-50/40 p-4 rounded-xl border border-blue-105 flex flex-col gap-2.5">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Chọn mẫu mã & Màu sắc áo thun sỉ</label>
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

                    {selectedTshirtGroup && (
                      <div className="flex justify-between items-center text-xs text-slate-500 font-bold bg-white px-3 py-1.5 rounded-lg border border-slate-100">
                        <span>Giá bán buôn buýt:</span>
                        <span className="text-blue-600 font-black">
                          {formatCurrency(activeGroupSizes[0]?.salePrice || 100000)} / cái
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Size Matrix Grid */}
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

                  {/* Design Print Image Uploader for T-shirt */}
                  <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-205 space-y-3">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                      Hình thiết kế hình in kẹp áo thun sỉ (Nếu có)
                    </label>
                    <div className="flex items-center gap-4">
                      <div className="relative w-14 h-14 bg-white border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden shadow-sm">
                        {tshirtPrintImage ? (
                          <img src={tshirtPrintImage} alt="Hình in" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <ImageIcon className="w-7 h-7 text-slate-300" />
                        )}
                        {tshirtPrintImage && (
                          <button
                            type="button"
                            onClick={() => setActivePreviewImage(tshirtPrintImage)}
                            className="absolute inset-0 bg-black/40 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="flex-1 space-y-0.5">
                        <span className="block text-xs font-bold text-slate-700">Tải tệp hình in lên</span>
                        <span className="block text-[10px] text-slate-400">Chọn tệp hình ảnh thực tế thi công</span>
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-105 border border-blue-150 text-blue-700 text-xs font-bold rounded-lg transition-colors cursor-pointer mt-1">
                          <Upload className="w-3.5 h-3.5" />
                          <span>{uploadingTshirtPrintImage ? 'Đang tải...' : 'Upload Hình In Lên Áo'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleTshirtPrintImageUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* T-shirt Add to Cart trigger */}
                  <button
                    type="button"
                    onClick={handleAddTshirtsToCart}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold text-xs text-center rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/10 uppercase tracking-wider cursor-pointer border border-blue-700 mt-2.5 font-sans"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Thêm lô sỉ áo thun vào giỏ đơn</span>
                  </button>
                </div>
              )}

              {/* SECTION 2: SHOPPING CART ITEM PREVIEW (REAL TIME) */}
              <div className="bg-slate-50 p-4.5 rounded-2xl border border-slate-200/60 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 flex-shrink-0 animate-fade-in">
                  <div className="flex items-center gap-1.5 font-bold">
                    <ShoppingBag className="w-4.5 h-4.5 text-blue-600 animate-pulse" />
                    <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">Bước 2: Giỏ đơn hàng hiện tại ({cartItems.length} sản phẩm)</span>
                  </div>
                  {cartItems.length > 0 && (
                    <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-150 shadow-sm animate-scale-in">
                      Tổng tiền: {formatCurrency(totalPrice)}
                    </span>
                  )}
                </div>

                {cartItems.length === 0 ? (
                  <div className="text-center py-7 text-slate-450 font-semibold text-xs bg-white rounded-xl border border-dashed border-slate-305 shadow-inner">
                    Giỏ hàng trống. Vui lòng thiết lập mặt hàng bất kỳ ở trên và click "Thêm lô..."
                  </div>
                ) : (
                  <div className="max-h-52 overflow-y-auto space-y-2 pr-1 animate-scale-in">
                    {cartItems.map((item) => (
                      <div key={item.id} className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between gap-3 text-xs shadow-sm">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {item.image ? (
                            <div className="relative group flex-shrink-0">
                              <img
                                src={item.image}
                                alt="Mẫu trong giỏ"
                                onClick={() => setActivePreviewImage(item.image!)}
                                className="w-10 h-10 object-cover rounded shadow-sm border border-slate-200 cursor-zoom-in hover:scale-102 transition-transform"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          ) : (
                            <div className="w-10 h-10 bg-slate-50 rounded border border-dashed border-slate-200 flex items-center justify-center text-slate-400 flex-shrink-0">
                              <ShoppingBag className="w-4 h-4 opacity-40" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-850 block truncate">{item.productName}</span>
                            {item.color && (
                              <span className="text-[10px] text-slate-450 block truncate font-mono font-bold">{item.color.replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right whitespace-nowrap font-semibold">
                            <span className="text-[10px] text-slate-400 block font-mono font-bold">{item.quantity} x {formatCurrency(item.unitPrice)}</span>
                            <span className="text-xs font-extrabold text-blue-600 font-mono block">{formatCurrency(item.totalPrice)}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCartItem(item.id)}
                            className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                            title="Xóa ra khỏi giỏ đơn"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECTION 3: BILLING & PAYMENT STATUS CHECKOUT */}
              {cartItems.length > 0 && (
                <div className="bg-slate-50 p-4.5 rounded-2xl border border-slate-200/60 space-y-3.5 shadow-inner">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-600">Bước 3: Trạng thái thanh toán (Mặc định: Chưa thanh toán)</span>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-xl border border-slate-200/55 hover:border-blue-500 transition-colors flex-1 shadow-sm">
                      <input
                        type="radio"
                        name="payment_type"
                        checked={paymentType === 'unpaid'}
                        onChange={() => {
                          setPaymentType('unpaid');
                          setPaidAmount(0);
                        }}
                        className="w-4.5 h-4.5 text-blue-600 border-slate-350 pointer-events-auto"
                      />
                      <span className="text-xs font-bold text-slate-700 animate-fade-in">Chưa thanh toán</span>
                    </label>

                    <label className="inline-flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-xl border border-slate-200/55 hover:border-blue-500 transition-colors flex-1 shadow-sm">
                      <input
                        type="radio"
                        name="payment_type"
                        checked={paymentType === 'partial'}
                        onChange={() => {
                          setPaymentType('partial');
                          setPaidAmount(Math.round(totalPrice / 2));
                        }}
                        className="w-4.5 h-4.5 text-blue-600 border-slate-350 pointer-events-auto"
                      />
                      <span className="text-xs font-bold text-slate-700">Trả 1 phần</span>
                    </label>

                    <label className="inline-flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-xl border border-slate-200/55 hover:border-blue-500 transition-colors flex-1 shadow-sm">
                      <input
                        type="radio"
                        name="payment_type"
                        checked={paymentType === 'full'}
                        onChange={() => {
                          setPaymentType('full');
                          setPaidAmount(totalPrice);
                        }}
                        className="w-4.5 h-4.5 text-blue-600 border-slate-350"
                      />
                      <span className="text-xs font-bold text-slate-705 font-sans">Thanh toán đủ</span>
                    </label>
                  </div>

                  {paymentType === 'partial' && (
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/55 text-xs animate-fade-in">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-450 mb-1 font-sans">Số tiền trả trước (VND)</label>
                        <input
                          type="number"
                          min="0"
                          max={totalPrice}
                          required
                          value={paidAmount}
                          onChange={(e) => setPaidAmount(Math.min(totalPrice, Math.max(0, Number(e.target.value))))}
                          className="w-full px-3 py-1.5 bg-white border border-slate-205 rounded-lg font-mono text-xs focus:outline-none focus:border-blue-500 font-bold"
                        />
                      </div>

                      <div className="text-right flex flex-col justify-end font-extrabold">
                        <span className="text-[10px] uppercase font-bold text-rose-550 block font-sans">Số tiền còn nợ lại</span>
                        <span className="text-sm font-mono text-rose-600">{formatCurrency(debtAmount)}</span>
                      </div>
                    </div>
                  )}

                  {paymentType === 'unpaid' && (
                    <div className="pt-2.5 border-t border-slate-200/40 text-xs flex justify-between items-center text-rose-600 font-bold font-mono animate-fade-in">
                      <span className="font-sans">Còn nợ lại 100%:</span>
                      <span>{formatCurrency(totalPrice)}</span>
                    </div>
                  )}

                  {paymentType === 'full' && (
                    <div className="pt-2.5 border-t border-slate-200/40 text-xs flex justify-between items-center text-emerald-600 font-bold font-mono animate-fade-in">
                      <span className="font-sans">Thanh toán hoàn tất:</span>
                      <span>{formatCurrency(totalPrice)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 4: ORDER NOTES (Ghi chú đơn hàng) */}
              {cartItems.length > 0 && (
                <div className="bg-slate-50 p-4.5 rounded-2xl border border-slate-200/60 space-y-2 shadow-inner">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">Ghi chú đơn hàng (Thay thế mã đơn hàng)</label>
                  <textarea
                    rows={2}
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Nhập ghi chú riêng của đơn này (ví dụ: Ủi mác, Đóng bao bì, Ship xe Phương Trang, v.v.)"
                    className="w-full px-3 py-2 bg-white border border-slate-205 rounded-xl text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <p className="text-[10px] text-slate-400">Nếu bạn điền ghi chú này, nó sẽ hiển thị thay thế cho Mã đơn hàng ở bảng kê công nợ.</p>
                </div>
              )}
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 hover:bg-slate-100 border border-slate-200 text-slate-500 font-extrabold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold text-xs text-center rounded-xl transition-colors shadow-lg shadow-blue-500/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider font-bold"
                  disabled={cartItems.length === 0}
                >
                  Lưu hóa đơn & Ghi sổ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox Preview Modal */}
      {activePreviewImage && (
        <div 
          className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[100] flex flex-col justify-between p-4 animate-fade-in text-slate-200 select-none outline-none"
          onClick={() => {
            setActivePreviewImage(null);
            setLightboxZoom(1);
            setLightboxRotate(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
              setActivePreviewImage(null);
              setLightboxZoom(1);
              setLightboxRotate(0);
            }
          }}
          tabIndex={0}
        >
          {/* Lightbox Header */}
          <div 
            className="w-full flex items-center justify-between border-b border-slate-800 pb-3 h-14 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                <ImageIcon className="w-4.5 h-4.5 text-blue-400" />
              </div>
              <div>
                <h4 className="font-extrabold text-white text-xs sm:text-sm uppercase tracking-wider flex items-center gap-2">
                  <span>Trình xem ảnh thiết kế gốc</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full lowercase font-mono">100% Gốc</span>
                </h4>
                <p className="text-[10px] text-slate-400">Hình ảnh thiết kế lưu trữ chất lượng tối đa, không bị nén dung lượng.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActivePreviewImage(null);
                  setLightboxZoom(1);
                  setLightboxRotate(0);
                }}
                className="w-9 h-9 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-xl flex items-center justify-center font-black text-lg transition-all cursor-pointer shadow border border-slate-700 hover:text-white"
                title="Đóng (Esc/X)"
              >
                &times;
              </button>
            </div>
          </div>

          {/* Interactive Zoom and Pan Workspace */}
          <div 
            className="flex-1 w-full my-3 overflow-auto flex items-center justify-center relative bg-slate-950/50 rounded-2xl border border-slate-900 shadow-inner group/workspace"
            onClick={() => {
              setActivePreviewImage(null);
              setLightboxZoom(1);
              setLightboxRotate(0);
            }}
          >
            <div 
              className="max-w-full max-h-full transition-transform duration-200"
              style={{
                transform: `rotate(${lightboxRotate}deg)`,
                width: 'fit-content',
                height: 'fit-content'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={activePreviewImage}
                alt="Preview Design"
                className="object-contain transition-all duration-155 rounded-lg max-w-[85vw] max-h-[70vh] shadow-2xl border border-white/5"
                style={{
                  transform: `scale(${lightboxZoom})`,
                  transformOrigin: 'center center',
                  imageRendering: lightboxRendering === 'crisp' ? 'pixelated' : 'auto',
                  maxWidth: lightboxZoom > 1 ? 'none' : '85vw',
                  maxHeight: lightboxZoom > 1 ? 'none' : '70vh',
                }}
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

          {/* Controls Footer */}
          <div 
            className="w-full bg-slate-900 border border-slate-850 rounded-2xl p-4 md:px-6 flex flex-col md:flex-row items-center justify-between gap-4 flex-shrink-0 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Zoom Controls */}
            <div className="flex items-center gap-4.5 w-full md:w-auto">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest min-w-[64px]">Thu phóng:</span>
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-1.5 px-3">
                <button
                  type="button"
                  onClick={() => setLightboxZoom(prev => Math.max(0.5, prev - 0.25))}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer font-bold flex items-center justify-center transition-colors text-sm"
                  title="Thu nhỏ (-25%)"
                >
                  -
                </button>
                <span className="text-xs font-mono font-bold text-blue-400 min-w-[50px] text-center bg-slate-900 py-1 px-2.5 rounded-md border border-slate-800">
                  {Math.round(lightboxZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxZoom(prev => Math.min(4, prev + 0.25))}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer font-bold flex items-center justify-center transition-colors text-sm"
                  title="Phóng to (+25%)"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxZoom(1)}
                  className="text-[10px] bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white px-2 py-1.5 rounded-md cursor-pointer transition-colors uppercase font-bold tracking-wide"
                  title="Về kích thước chuẩn ban đầu"
                >
                  Chuẩn
                </button>
              </div>
            </div>

            {/* Quality & Detail Toggles */}
            <div className="flex flex-wrap items-center gap-3.5 w-full md:w-auto">
              {/* Rotate Option */}
              <button
                type="button"
                onClick={() => setLightboxRotate(prev => (prev + 90) % 360)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-250 text-[11px] font-bold rounded-xl cursor-pointer transition-all hover:text-white inline-flex items-center gap-1.5"
                title="Xoay hình ảnh thêm 90 độ"
              >
                <RotateCw className="w-3.5 h-3.5 text-blue-400" />
                <span>Xoay 90°</span>
              </button>

              {/* Crisp Rendering Option */}
              <button
                type="button"
                onClick={() => setLightboxRendering(prev => prev === 'smooth' ? 'crisp' : 'smooth')}
                className={`px-3.5 py-2 border rounded-xl text-[11px] font-extrabold cursor-pointer transition-all inline-flex items-center gap-1.5 ${
                  lightboxRendering === 'crisp' 
                    ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/10' 
                    : 'bg-slate-800 border-slate-705 text-slate-400 hover:text-white'
                }`}
                title="Bật tính năng này giúp hiển thị ảnh sắc nét đến từng điểm ảnh (không bị mờ bệt do trình duyệt tự làm mịn)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Chế độ: {lightboxRendering === 'crisp' ? 'Hiện Siêu Nét' : 'Làm mịn thường'}</span>
              </button>
            </div>

            {/* Download and Original File actions */}
            <div className="flex items-center gap-2.5 w-full md:w-auto">
              <a
                href={activePreviewImage}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 md:flex-none px-4 py-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-blue-400 text-center font-bold text-[11px] rounded-xl transition-all hover:text-white inline-flex items-center justify-center gap-1.5 uppercase tracking-wider"
                title="Mở ảnh trong một tab mới ở độ phân giải thật của file để kiểm duyệt"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Mở tab mới (100% Gốc)</span>
              </a>

              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch(activePreviewImage);
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    // Try to guess extension or default to png
                    const extension = blob.type ? blob.type.split('/')[1] : 'png';
                    a.download = `file_thiet_ke_goc_${Date.now()}.${extension}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    showToast('Đã bắt đầu tải tệp thiết kế độ phân giải gốc xuống thiết bị!', 'success');
                  } catch (err) {
                    // Fallback to simple a href download
                    const a = document.createElement('a');
                    a.href = activePreviewImage;
                    a.download = `file_goc_${Date.now()}.png`;
                    a.target = '_blank';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }
                }}
                className="flex-1 md:flex-none px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:brightness-110 text-white font-extrabold text-[11px] rounded-xl transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 uppercase tracking-wider shadow-lg shadow-blue-500/10"
                title="Tải tập tin thiết kế gốc độ nét tuyệt đối về máy tính/điện thoại"
              >
                <Download className="w-4 h-4" />
                <span>Tải File Gốc (Full Size)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9:16 Mobile Invoice Preview Modal */}
      {previewOrder && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-sm flex flex-col max-h-[95vh] overflow-hidden my-auto animate-scale-in">
            {/* Modal Header */}
            <div className="px-5 py-4 bg-slate-800 border-b border-slate-700 flex items-center justify-between flex-shrink-0 text-white">
              <div className="flex items-center gap-2">
                <FileText className="w-4.5 h-4.5 text-blue-400" />
                <h3 className="font-bold text-xs tracking-wide uppercase">Hóa Đơn Mobile (9:16)</h3>
              </div>
              <button
                onClick={() => setPreviewOrder(null)}
                className="text-white/85 hover:text-white cursor-pointer text-xl font-bold transition-transform hover:scale-110"
              >
                &times;
              </button>
            </div>

            {/* Scrollable Receipt Area */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-950 flex flex-col items-center">
              {/* Thermal Receipt Container */}
              <div 
                id="mobile-invoice-receipt"
                className="bg-[#FCFCF9] text-slate-800 w-[320px] min-h-[568px] p-5 shadow-2xl relative rounded-xl flex flex-col justify-between font-sans overflow-hidden border border-amber-200/30"
              >
                <div className="absolute top-0 inset-x-0 h-1 bg-blue-900" />
                
                <div className="space-y-3.5 flex-1">
                  {/* Branding */}
                  <div className="text-center space-y-0.5 pb-3 border-b border-dashed border-slate-300">
                    <h4 className="text-xs font-black text-blue-900 tracking-wider uppercase">
                      CƠ SỞ IN ẤN HOÀNG UYÊN
                    </h4>
                    <p className="text-[9px] text-slate-500 font-medium">
                      Gia Công In PET DTF & Áo Thun Sỉ Toàn Quốc
                    </p>
                    <p className="text-[8px] text-slate-400 font-mono">
                      Hotline: 0931325512 - 0941727079 — Đ/C: 557/51A Hương Lộ 3, Bình Tân, TP.HCM
                    </p>
                  </div>

                  {/* Metadata */}
                  <div className="bg-slate-50/80 p-2.5 rounded-lg border border-slate-100 space-y-1 text-[11px] text-slate-700">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Khách hàng:</span>
                      <span className="font-black text-slate-800">{previewOrder.customerName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Mã đơn:</span>
                      <span className="font-mono font-bold text-blue-900 bg-blue-50 px-1 rounded">{previewOrder.orderCode}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Ngày lập:</span>
                      <span className="font-medium font-mono text-slate-600">{new Date(previewOrder.createdAt).toLocaleDateString('vi-VN')}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Kiểu đơn:</span>
                      <span className="font-bold text-[10px] uppercase text-slate-600">
                        {previewOrder.type === 'dtf' ? 'In PET DTF' : previewOrder.type === 'tshirt' ? 'Bán Sỉ Áo Thun' : 'Hợp Nhất'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1.5 border-t border-dashed border-slate-200">
                      <span className="text-slate-400 font-medium">Trạng thái:</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                        previewOrder.status === 'completed' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : previewOrder.status === 'pending'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-150 text-slate-600'
                      }`}>
                        {previewOrder.status === 'completed' ? 'Đã thu đủ' : previewOrder.status === 'pending' ? 'Ghi nợ' : 'Đã hủy'}
                      </span>
                    </div>
                  </div>

                  {/* Items list */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider block">Chi tiết đơn hàng:</span>
                    
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-0.5">
                      {previewOrder.items && previewOrder.items.length > 0 ? (
                        previewOrder.items.map((item, idx) => (
                          <div key={item.id || idx} className="bg-white p-2 rounded-lg border border-slate-150 flex gap-2 text-[11px] items-center">
                            {item.image && (
                              <img src={item.image} alt="mẫu" className="w-8 h-8 rounded object-cover border border-slate-100 flex-shrink-0" referrerPolicy="no-referrer" />
                            )}
                            <div className="flex-1 min-w-0">
                              <span className="block font-bold text-slate-850 truncate">{item.productName}</span>
                              <span className="block text-[9px] text-slate-400 font-mono truncate">{item.color.replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')}</span>
                              <div className="flex items-center justify-between mt-0.5 text-[9px]">
                                <span className="font-mono text-slate-400">SL: {item.quantity} x {item.unitPrice.toLocaleString('vi-VN')}</span>
                                <span className="font-bold text-slate-800 font-mono">{formatCurrency(item.totalPrice)}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        // Legacy single-item fallback
                        <div className="bg-white p-2 rounded-lg border border-slate-155 flex gap-2 text-[11px] items-center">
                          {Array.isArray(previewOrder.orderImages) && previewOrder.orderImages[0] && (
                            <img src={previewOrder.orderImages[0]} alt="mẫu" className="w-8 h-8 rounded object-cover border border-slate-100 flex-shrink-0" referrerPolicy="no-referrer" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="block font-bold text-slate-850 truncate">{previewOrder.productName}</span>
                            <span className="block text-[9px] text-slate-400 font-mono truncate">{(previewOrder.color || 'Mặc định').replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')}</span>
                            <div className="flex items-center justify-between mt-0.5 text-[9px]">
                              <span className="font-mono text-slate-450 font-medium">SL: {previewOrder.quantity} x {previewOrder.unitPrice.toLocaleString('vi-VN')}</span>
                              <span className="font-bold text-slate-800 font-mono">{formatCurrency(previewOrder.totalPrice)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Billing totals */}
                <div className="space-y-2 pt-3 border-t border-dashed border-slate-300">
                  <div className="space-y-0.5 text-[11px]">
                    <div className="flex justify-between items-center font-medium">
                      <span className="text-slate-400">TỔNG CỘNG:</span>
                      <span className="font-bold text-slate-700 font-mono">{formatCurrency(previewOrder.totalPrice)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-emerald-600 font-bold">ĐÃ THANH TOÁN:</span>
                      <span className="font-extrabold text-emerald-600 font-mono">{formatCurrency(previewOrder.paidAmount)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs pt-1 border-t border-slate-150">
                      <span className="font-black text-rose-600">CÒN NỢ LẠI:</span>
                      <span className="font-black text-rose-600 font-mono">{formatCurrency(previewOrder.debtAmount)}</span>
                    </div>
                  </div>

                  <div className="text-center pt-1.5 pb-0 bg-slate-50 p-2 rounded-lg border border-slate-100 text-[9px] text-slate-400 leading-tight">
                    <span>Xin vui lòng thanh toán đối chiếu ảnh này khi nhận hàng. Cảm ơn quý khách hàng!</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="px-4 py-3 bg-slate-800 border-t border-slate-700 flex flex-col gap-2 flex-shrink-0">
              <button
                type="button"
                disabled={downloadingPNG}
                onClick={handleDownloadInvoicePNG}
                className="w-full py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-extrabold text-xs text-center rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 uppercase tracking-wider"
              >
                <Download className="w-3.5 h-3.5 animate-bounce" />
                <span>{downloadingPNG ? 'Đang xuất ảnh...' : 'Tải ảnh Gửi Zalo (9:16)'}</span>
              </button>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    generateInvoicePDF(previewOrder);
                  }}
                  className="py-1.5 bg-slate-700 hover:bg-slate-655 text-slate-300 border border-slate-600 text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Mẫu A5 PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOrder(null)}
                  className="py-1.5 bg-slate-800 hover:bg-slate-755 text-slate-450 border border-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-[200] max-w-sm bg-slate-900 border border-slate-700 text-white rounded-xl shadow-2xl p-4 flex items-center gap-3 animate-fade-in font-sans">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            toastType === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
            toastType === 'error' ? 'bg-rose-500/20 text-rose-400' :
            'bg-blue-500/20 text-blue-400'
          }`}>
            {toastType === 'error' ? (
              <Ban className="w-5 h-5 text-rose-500" />
            ) : (
              <CheckCircle className="w-5 h-5 text-emerald-500" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold leading-tight">{toastMessage}</p>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white font-bold text-sm cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in text-slate-700">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-blue-900 text-white">
              <h3 className="font-bold text-lg">Chỉnh Sửa Chi Tiết Đơn Hàng</h3>
              <button
                onClick={() => setEditingOrder(null)}
                className="text-white/80 hover:text-white cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleEditOrderSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Tên Khách Hàng</label>
                <input
                  type="text"
                  required
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Mã đơn hàng</label>
                  <input
                    type="text"
                    disabled
                    value={editingOrder.orderCode}
                    className="w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm font-semibold text-slate-400 cursor-not-allowed font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Ngày ghi sổ (Tạo đơn)</label>
                  <input
                    type="date"
                    required
                    value={editCreatedAt}
                    onChange={(e) => setEditCreatedAt(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Số lượng / Số mét</label>
                  <input
                    type="text"
                    required
                    value={editQtyStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditQtyStr(val);
                      const parsedQty = parseFloat(val);
                      if (!isNaN(parsedQty) && parsedQty >= 0) {
                        setEditQuantity(parsedQty);
                        
                        // Recalculate totalPrice if unit price is valid
                        const currentUnitPrice = parseFloat(editUnitPriceStr) || 0;
                        const newTotal = Number((parsedQty * currentUnitPrice).toFixed(0));
                        setEditTotalPrice(newTotal);
                        setEditTotalPriceStr(String(newTotal));
                        
                        const parsedPaid = parseFloat(editPaidAmountStr) || 0;
                        if (parsedPaid > newTotal) {
                          setEditPaidAmount(newTotal);
                          setEditPaidAmountStr(String(newTotal));
                        }
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Đơn Giá (VND)</label>
                  <input
                    type="text"
                    required
                    value={editUnitPriceStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditUnitPriceStr(val);
                      const parsedPrice = parseFloat(val);
                      if (!isNaN(parsedPrice) && parsedPrice >= 0) {
                        setEditUnitPrice(parsedPrice);
                        
                        // Recalculate totalPrice if quantity is valid
                        const currentQty = parseFloat(editQtyStr) || 0;
                        const newTotal = Number((currentQty * parsedPrice).toFixed(0));
                        setEditTotalPrice(newTotal);
                        setEditTotalPriceStr(String(newTotal));
                        
                        const parsedPaid = parseFloat(editPaidAmountStr) || 0;
                        if (parsedPaid > newTotal) {
                          setEditPaidAmount(newTotal);
                          setEditPaidAmountStr(String(newTotal));
                        }
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Tổng Tiền (VND)</label>
                  <input
                    type="text"
                    required
                    value={editTotalPriceStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditTotalPriceStr(val);
                      const parsedTotal = parseFloat(val);
                      if (!isNaN(parsedTotal) && parsedTotal >= 0) {
                        setEditTotalPrice(parsedTotal);
                        
                        const parsedPaid = parseFloat(editPaidAmountStr) || 0;
                        if (parsedPaid > parsedTotal) {
                          setEditPaidAmount(parsedTotal);
                          setEditPaidAmountStr(String(parsedTotal));
                        }
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Đã Thanh Toán (VND)</label>
                  <input
                    type="text"
                    required
                    value={editPaidAmountStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditPaidAmountStr(val);
                      const parsedPaid = parseFloat(val);
                      if (!isNaN(parsedPaid) && parsedPaid >= 0) {
                        const targetTotal = parseFloat(editTotalPriceStr) || 0;
                        const clampedPaid = Math.min(targetTotal, parsedPaid);
                        setEditPaidAmount(clampedPaid);
                      }
                    }}
                    onBlur={() => {
                      const parsedPaid = parseFloat(editPaidAmountStr) || 0;
                      const targetTotal = parseFloat(editTotalPriceStr) || 0;
                      const clampedPaid = Math.min(targetTotal, Math.max(0, parsedPaid));
                      setEditPaidAmount(clampedPaid);
                      setEditPaidAmountStr(String(clampedPaid));
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Số Tiền Còn Nợ</label>
                <div className="w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm font-mono font-bold text-rose-600">
                  {formatCurrency(Math.max(0, (parseFloat(editTotalPriceStr) || 0) - (parseFloat(editPaidAmountStr) || 0)))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Trạng thái đơn hàng</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as OrderStatus)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold cursor-pointer"
                >
                  <option value="pending">Còn nợ (Chưa thu đủ)</option>
                  <option value="completed">Đã thu đủ</option>
                  <option value="cancelled">Đã hủy đơn</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Ghi chú đơn hàng (Thay thế mã đơn hàng)</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Nhập ghi chú riêng của đơn này (Ví dụ: Ship xe đò, Ủi nhãn mác, v.v.)"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="px-4 py-2 hover:bg-slate-100 text-slate-500 font-semibold text-sm rounded-xl cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl cursor-pointer"
                >
                  Cập nhật đơn hàng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Order Confirmation Dialog */}
      {deletingOrder && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in text-slate-700">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-rose-100 flex items-center justify-between bg-rose-600 text-white">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span>Xác nhận xóa đơn hàng</span>
              </h3>
              <button
                onClick={() => setDeletingOrder(null)}
                className="text-white hover:text-rose-100 cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm font-semibold text-slate-700">
                Bạn có chắc chắn muốn xóa đơn hàng này không?
              </p>
              <div className="p-4 bg-rose-50 border border-rose-105 rounded-xl text-xs space-y-1 text-slate-800">
                <div className="flex justify-between font-bold">
                  <span>Mã đơn:</span>
                  <span className="text-rose-650 font-mono">{deletingOrder.orderCode}</span>
                </div>
                <div className="flex justify-between">
                  <span>Khách hàng:</span>
                  <span className="font-bold text-slate-700">{deletingOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Sản phẩm:</span>
                  <span className="font-semibold text-slate-700 max-w-[200px] truncate" title={deletingOrder.productName}>
                    {deletingOrder.productName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Tổng tiền:</span>
                  <span className="font-bold text-slate-800 font-mono">{formatCurrency(deletingOrder.totalPrice)}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 italic">
                Lưu ý: Hành động này là vĩnh viễn và không thể khôi phục lại.
              </p>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 text-sm">
              <button
                type="button"
                onClick={() => setDeletingOrder(null)}
                className="px-4 py-2 hover:bg-slate-200 text-slate-500 font-semibold rounded-xl cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleDeleteOrderConfirm}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl cursor-pointer"
              >
                Đồng ý xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
