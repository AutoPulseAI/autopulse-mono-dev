<h5 class="modal-title text_primary mb-3"><b>Store Checkout</b></h5>

<!-- Subscription plans selection -->
<div class="position-relative">
    @foreach($plans as $plan)
        <div class="row">
            <div class="col col-7">
                <div class="form-check">
                    <input class="form-check-input subscription-plan" type="radio" value="{{ $plan->id }}" name="subscription_plan" id="plan{{ $plan->id }}" data-plan-id="{{ $plan->id }}" {{ $planId == $plan->id ? 'checked' : '' }}>
                    <label class="form-check-label" for="plan{{ $plan->id }}">{{ $plan->name }}</label>
                    &nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="{{ $plan->description }}"><i class="fa-regular fa-circle-info"></i></a>
                </div>
            </div>
            <div class="col col-5">
                <div class="leads_by text-end">
                    <p class="mb-0 plan-price" data-plan-id="{{ $plan->id }}">${{ $plan->price }} / {{ ucfirst($plan->interval) }}</p>
                </div>
            </div>
        </div>
    @endforeach
</div>

<hr>

<!-- Store List with coupon -->
<div class="position-relative">
    @foreach($stores as $store)
        <div class="row gx-2 mb-3 justify-content-end" id="store-{{ $store->id }}">
            <div class="col col-lg-4 col-md-7 col-12 d-flex align-items-center">
                <div class="leads_by">
                    <p class="mb-0"><b>{{ $store->dealership_name }}</b></p>
                </div>
            </div>
            <div class="col col-lg-3 col-md-5 col-12 d-flex align-items-center mb-lg-0 mb-2">
                <div class="leads_by text-md-end w-100">
                    <p class="mb-0">
                        @if (isset($coupons[$store->id]) && $coupons[$store->id]['valid'])
                            <small class="text_secondary"><del>${{ $store->actual_price }} /-</del></small>&nbsp;${{ $store->subscription_price }} /-
                            <p class="mb-0 text-success text-nowrap"><small>You Saved ${{ $store->actual_price - $store->subscription_price }} by Coupon!</small></p>
                        @elseif (isset($coupons[$store->id]) && !$coupons[$store->id]['valid'])
                            <small class="text_secondary"><del>${{ $store->actual_price }} /-</del></small>&nbsp;${{ $store->subscription_price }} /-
                            <p class="mb-0 text-danger text-nowrap"><small>Invalid Coupon!</small></p>
                        @else
                            ${{ $store->subscription_price }} /-
                        @endif
                    </p>
                </div>
            </div>
            <div class="col col-lg-5 col-md-10 col-12">
                <div class="input-group applyedit flex-nowrap">
                    @if (isset($coupons[$store->id]) && $coupons[$store->id]['valid'])
                        <div class="leads_by w-100">
                            <p class="mb-0 form-control border-end-0 mb-0 pe-0"><i class="fa-solid fa-circle-check text-success me-1"></i>Coupon Code Applied!</p>
                        </div>
                        <input type="text" class="form-control border-end-0 mb-0 pe-0 d-none coupon-input" placeholder="Type coupon code here" value="{{ $coupons[$store->id]['code'] }}" data-store-id="{{ $store->id }}">
                        <button class="btn border border-start-0 px-2 text_primary apply-coupon-btn" data-store-id="{{ $store->id }}" type="button">EDIT</button>
                    @elseif (isset($coupons[$store->id]) && !$coupons[$store->id]['valid'])
                        <input type="text" class="form-control border-end-0 mb-0 pe-0 coupon-input is-invalid" placeholder="Type coupon code here" value="{{ $coupons[$store->id]['code'] }}" data-store-id="{{ $store->id }}">
                        <button class="btn border border-start-0 px-2 text_primary apply-coupon-btn" data-store-id="{{ $store->id }}" type="button">APPLY</button>
                    @else
                        <input type="text" class="form-control border-end-0 mb-0 pe-0 coupon-input" placeholder="Type coupon code here" value="{{ $coupons[$store->id]['code'] ?? '' }}" data-store-id="{{ $store->id }}">
                        <button class="btn border border-start-0 px-2 text_primary apply-coupon-btn" data-store-id="{{ $store->id }}" type="button">APPLY</button>
                    @endif
                    <button class="btn btn-secondary border-0 delete-store-btn ms-0 px-3" data-store-id="{{ $store->id }}" type="button"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        </div>
    @endforeach
</div>

<hr>

<div class="position-relative">
    <div class="leads_by">
        <p class="mb-0 d-flex"><span>You have added</span><span class="ms-auto">{{ $stores->count() }} Stores</span></p>
    </div>
</div>

<hr>
@if($otherStores->count() >0)
<div class="position-relative checkout_unsub_stores" data-bs-toggle="collapse" data-bs-target="#collapseStores" aria-expanded="false" aria-controls="collapseStores">
    <div class="leads_by">
        <p class="mb-0">
            <a href="javascript:" class="text_dark d-flex">
                <span>Take subscription for other stores</span><span class="ms-auto"><i class="fa-solid fa-chevron-down"></i></span>
            </a>
        </p>
    </div>
</div>
<div class="position-relative pt-3 collapse" id="collapseStores">
    @foreach($otherStores as $store)
        <p class="mb-2 d-flex"><span>{{ $store->dealership_name }}</span><span class="ms-auto"><a href="javascript:" class="text_primary move-to-cart-btn" data-store-id="{{ $store->id }}">Move to Cart</a></span></p>
    @endforeach
</div>
<hr>
@endif



<div class="position-relative mb-4">
    <h5 class="mb-0 d-flex"><b>Total Amount</b><b class="ms-auto text_primary">$<span id="total-amount">{{ $totalAmount }}</span>/-</b></h5>
</div>

<div class="position-relative text-center">
    <div class="row">
        <div class="col col-6">
            <button data-bs-dismiss="modal" class="btn btn_theme_outline w-100">Cancel</button>
        </div>
        <div class="col col-6">
            <a href='{{ route("dealer.store.add_payment_method") }}'  class="btn btn_theme w-100">Proceed</a>
        </div>
    </div>
</div>

<script>
// Popover
var popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'))
var popoverList = popoverTriggerList.map(function (popoverTriggerEl) {
    return new bootstrap.Popover(popoverTriggerEl)
});

$(document).ready(function() {
    function loadCartPopup(data = {}) {
        url = '{{ route("dealer.cart") }}';
        data = {
                ...data,
                _token: '{{ csrf_token() }}'
            };
        runajax(url,data , 'post', '', 'json', function(response) {
        
            $('#storeCheckout').modal('show');
            $('#cardpopupbody').html(response.html);
        
        }); 
        
    }

    function collectData() {
        var coupons = {};
        var storelist = [];
        var planId = $('input[name="subscription_plan"]:checked').val();

        $('.coupon-input').each(function() {
            var id = $(this).data('store-id');
            coupons[id] = $(this).val();
            storelist.push(id);
        });

        return { plan_id: planId, coupons: coupons, storelist: storelist };
    }

    $(document).off('click', '.apply-coupon-btn').on('click', '.apply-coupon-btn', function() {
        var storeId = $(this).data('store-id');
        var couponCode = $(this).siblings('.coupon-input').val();
        var data = collectData();
        data.coupons[storeId] = couponCode;
        loadCartPopup(data);
    });

    $(document).off('change', '.subscription-plan').on('change', '.subscription-plan', function() {
        var data = collectData();
        data.plan_id = $(this).val();
        loadCartPopup(data);
    });

    $(document).off('click', '.move-to-cart-btn').on('click', '.move-to-cart-btn', function() {
        var storeId = $(this).data('store-id');
        var data = collectData();
        data.storelist.push(storeId);
        loadCartPopup(data);
    });

    $(document).off('click', '.delete-store-btn').on('click', '.delete-store-btn', function() {
        var storeId = $(this).data('store-id');
        var data = collectData();
        data.storelist = data.storelist.filter(id => id != storeId); // Remove the store ID from the list
        loadCartPopup(data);
    });
    $(document).on('click', '#process-payment-btn', function() {
        var data = collectData();
        data = {
                ...data,
                _token: '{{ csrf_token() }}'
            };
        url ='{{ route("dealer.save_cart") }}';
        runajax(url,data , 'post', '', 'json', function(response) {
            
            window.location.href = '{{ route("dealer.store.add_payment_method") }}';
        
        }); 
    });
});

</script>
