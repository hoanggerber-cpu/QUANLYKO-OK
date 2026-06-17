
  }, [showModal, selectedProductType, isManualDtf, dtfItems]);

  const handleManualDtfImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const selectedFiles: File[] = e.target.files ? Array.from(e.target.files) : [];
    const file = selectedFiles[0];
    if (!file) return;

    if (selectedFiles.length > 1) {
      setDtfOrderAttachments(prev => [
        ...prev,
        ...selectedFiles.slice(1).map(extraFile => ({
          image: URL.createObjectURL(extraFile),
          rawFile: extraFile
        }))
      ]);
      showToast(`Đã thêm ${selectedFiles.length} ảnh PET DTF. Ảnh đầu tiên làm ảnh đại diện, các ảnh còn lại lưu kèm hóa đơn.`, 'success');
    }

    setUploadingManualDtfImage(true);
    const objectUrl = URL.createObjectURL(file);
    setManualDtfImage(objectUrl);
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleManualDtfImageUpload}
                                className="hidden"
                                disabled={uploadingManualDtfImage}
