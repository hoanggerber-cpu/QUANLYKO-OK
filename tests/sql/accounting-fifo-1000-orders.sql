\set ON_ERROR_STOP on
-- 1,000 invoices of 100,000 VND = 100,000,000 VND debt.
-- Three receipts of 10M, 20M, 20M must close precisely the oldest
-- 500 invoices; then a new 5M invoice raises unpaid debt to 55M.
-- Runs only inside GitHub's disposable PostgreSQL service.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','3ea90802-af4a-4163-b403-da7ee313eb6d',false);

DO $test$
DECLARE
  i integer;
  v_result jsonb;
  v_id text;
BEGIN
  FOR i IN 1..1000 LOOP
    v_id := 'fifo-thousand-' || lpad(i::text, 4, '0');
    SELECT public.create_order_atomic(
      v_id, 'FIFO-' || lpad(i::text,4,'0'),
      'Khach 1000 Don','dtf','c_dtf_1000',
      'In PET phim','Mặc định',1,100000,
      100000,0,100000,'pending',
      '{"images":[]}',('2026-01-01'::timestamptz + i * interval '1 minute'),
      NULL,'Chưa thanh toán',
      jsonb_build_array(jsonb_build_object(
        'id','itm-' || v_id,'type','dtf','product_name','In PET phim',
        'color','Mặc định','quantity',1,'unit_price',100000,'total_price',100000
      ))
    ) INTO v_result;
    IF v_result->>'state'<>'committed' THEN
      RAISE EXCEPTION 'Invoice % failed: %',i,v_result;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.orders WHERE customer_name='Khach 1000 Don')<>1000 OR
     (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach 1000 Don')<>100000000 THEN
    RAISE EXCEPTION 'Initial 1,000 invoice / 100M debt baseline incorrect';
  END IF;

  PERFORM public.record_customer_payment_atomic(
    'ee000001-0000-4000-8000-000000000001',
    'Khach 1000 Don','dtf','c_dtf_1000',10000000,'Thu lan 1',NULL
  );
  IF (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach 1000 Don')<>90000000 THEN
    RAISE EXCEPTION 'After 10M receipt, debt must be 90M';
  END IF;

  PERFORM public.record_customer_payment_atomic(
    'ee000002-0000-4000-8000-000000000002',
    'Khach 1000 Don','dtf','c_dtf_1000',20000000,'Thu lan 2',NULL
  );
  IF (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach 1000 Don')<>70000000 THEN
    RAISE EXCEPTION 'After 20M receipt, debt must be 70M';
  END IF;

  PERFORM public.record_customer_payment_atomic(
    'ee000003-0000-4000-8000-000000000003',
    'Khach 1000 Don','dtf','c_dtf_1000',20000000,'Thu lan 3',NULL
  );
  IF (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach 1000 Don')<>50000000 OR
     (SELECT count(*) FROM public.orders
      WHERE customer_name='Khach 1000 Don' AND status='completed')<>500 OR
     (SELECT count(*) FROM public.orders
      WHERE customer_name='Khach 1000 Don' AND status='pending')<>500 OR
     (SELECT sum(amount) FROM public.payment_allocations
      WHERE payment_id IN (
        'ee000001-0000-4000-8000-000000000001'::uuid,
        'ee000002-0000-4000-8000-000000000002'::uuid,
        'ee000003-0000-4000-8000-000000000003'::uuid
      ))<>50000000 THEN
    RAISE EXCEPTION 'FIFO must settle oldest 500 invoices exactly, debt=50M';
  END IF;

  IF (SELECT count(*) FROM public.orders
      WHERE customer_name='Khach 1000 Don'
        AND right(id,4)::int<=500 AND (paid_amount<>100000 OR debt_amount<>0))<>0 OR
     (SELECT count(*) FROM public.orders
      WHERE customer_name='Khach 1000 Don'
        AND right(id,4)::int>500 AND (paid_amount<>0 OR debt_amount<>100000))<>0 THEN
    RAISE EXCEPTION 'FIFO paid newer invoice before older one';
  END IF;

  SELECT public.create_order_atomic(
    'fifo-new-1001','FIFO-1001','Khach 1000 Don','dtf','c_dtf_1000',
    'In PET phim','Mặc định',1,5000000,5000000,0,5000000,'pending',
    '{"images":[]}','2026-10-24'::timestamptz,
    NULL,'Chưa thanh toán',
    '[{"id":"itm-fifo-new-1001","type":"dtf","product_name":"In PET phim","color":"Mặc định","quantity":1,"unit_price":5000000,"total_price":5000000}]'::jsonb
  ) INTO v_result;
  IF (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach 1000 Don')<>55000000 OR
     (SELECT count(*) FROM public.payment_history WHERE customer_name='Khach 1000 Don')<>3 THEN
    RAISE EXCEPTION 'A new unpaid invoice must increase debt from 50M to 55M without changing historic receipts';
  END IF;

  SELECT public.record_customer_payment_atomic(
    'ee000003-0000-4000-8000-000000000003',
    'Khach 1000 Don','dtf','c_dtf_1000',20000000,'Thu lan 3',NULL
  ) INTO v_result;
  IF v_result->>'duplicate'<>'true' OR
     (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach 1000 Don')<>55000000 THEN
    RAISE EXCEPTION 'Repeating confirmed receipt UUID must not decrease debt again';
  END IF;
END;
$test$;

RESET ROLE;
