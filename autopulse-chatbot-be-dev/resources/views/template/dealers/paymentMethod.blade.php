@extends('layouts.dealer')
 
@section('content')

<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
               
            </div>
            <div class="col col-lg-9 col-12">
                <!-- Payment -->
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-md-6 col-7">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    
                                    <div class="acc_page_heading">
                                        <h3>Payment Methods</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-md-6 col-5">
                                <div class="position-relative text-end">
                                    
                                <a href="{{route('dealer.add_payment_method') }}" class="btn btn_theme"> @if ($paymentMethod && $paymentMethod->card) Update Card @else Add Card @endif</a>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="acc_page_content acc_page_box">
                        <!-- Payment Method -->
                        @if ($paymentMethod && $paymentMethod->card)
                            <div class="position-relative">
                                <div class="position-relative mb-md-3 mb-2">
                                    <p class="text_secondary mb-1"><small>Card Details</small></p>
                                    <p class="mb-0">
                                        @if ($paymentMethod && $paymentMethod->card)
                                            <span>XXXX<span>&nbsp;-&nbsp;</span>XXXX<span>&nbsp;-&nbsp;</span>XXXX<span>&nbsp;-&nbsp;</span>{{ $paymentMethod->card->last4 }}</span>
                                            <span><span class="mx-2">-</span>{{ $paymentMethod->card->exp_month }}/{{ $paymentMethod->card->exp_year }}</span>
                                        @else
                                            <span>No Card Available</span>
                                        @endif
                                    </p>
                                </div>

                                <div class="position-relative mb-md-3 mb-2">
                                    <p class="text_secondary mb-1"><small>Name</small></p>
                                    <p class="mb-0">
                                        @if ($paymentMethod)
                                            {{ $paymentMethod->billing_details->name }}
                                        @else
                                            <span>No Name Available</span>
                                        @endif
                                    </p>
                                </div>

                                <div class="position-relative">
                                    <p class="text_secondary mb-1"><small>Billing Address</small></p>
                                    <p class="mb-0">
                                        @if ($paymentMethod && $paymentMethod->billing_details && $paymentMethod->billing_details->address)
                                            {{ $paymentMethod->billing_details->address->line1 }},
                                            {{ $paymentMethod->billing_details->address->city }},
                                            {{ $paymentMethod->billing_details->address->state }},
                                            {{ $paymentMethod->billing_details->address->postal_code }},
                                            {{ $paymentMethod->billing_details->address->country }}
                                        @else
                                            <span>No Address Available</span>
                                        @endif
                                    </p>
                                </div>
                            </div>
                        @else
                            <div class="position-relative">
                                <div class="no_cars_available py-5">
                                    <p class="mb-0"><span>No Cars Available</span></p>
                                </div>
                            </div>
                        @endif

                    </div>

                    <!-- Note -->
                    <div class="position-relative mt-lg-2 mt-3">
                        <p class="mb-0 stripe">Powered by stripe</p>
                    </div>

                    <script>
                    // Card Number
                    document.getElementById("cardNumber").addEventListener("input", function(event) {
                        let input = event.target.value;
                        input = input.replace(/\s/g, ''); // Remove any existing spaces
                        
                        // Format the input with spaces every 4 characters
                        input = input.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');

                        event.target.value = input;
                    });

                    // Expiry
                    document.getElementById("expiration").addEventListener("input", function(event) {
                        let input = event.target.value;
                        if (input.length === 2 && input.charAt(2) !== "/") {
                            event.target.value = input + "/";
                        }
                    });

                    document.getElementById("expiration").addEventListener("keydown", function(event) {
                        let input = event.target.value;
                        if (event.keyCode === 8 && input.length === 3) {
                            event.preventDefault();
                            event.target.value = input.substr(0, 2);
                        }
                    });
                    </script>

                </div>
            </div>
        </div>
    </div>
</section>
  <!-- Success Modal -->
<div class="modal fade" id="thank_you_msg" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="exampleModalLabel">Success</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        Your subscription has been processed successfully. You will be redirected shortly.
      </div>
      <!--div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
      </div-->
    </div>
  </div>
</div>


@endsection

@push ('after-scripts')
<script src="https://js.stripe.com/v3/"></script>
<script>
    const stripe = Stripe("{{ env('STRIPE_KEY')  }}"); // Use your actual public key
    const elements = stripe.elements();
    const cardElement = elements.create('card');
    cardElement.mount('#card-element');

    document.querySelectorAll('input[name="plan_id"]').forEach(input => {
        input.addEventListener('change', function() {
            document.getElementById('paymentForm').style.display = 'block';
        });
    });

    document.getElementById('card-button').addEventListener('click', function (event) {
        event.preventDefault();
        stripe.createPaymentMethod('card', cardElement).then(function(result) {
            if (result.error) {
                $('#card-errors').text(result.error.message).show();
            } else {
                // Send the PaymentMethod ID to your server
                //stripePaymentMethodHandler(result.paymentMethod.id);
                $('#token').val(result.paymentMethod.id);
                submitTokenToServer(result.paymentMethod.id);
            }
        });
        /*stripe.createToken(cardElement).then(function (result) {
            if (result.error) {
                $('#card-errors').text(result.error.message).show();
            } else {
                console.log(result.token.id);
                $('#token').val(result.token.id);
                submitTokenToServer(result.token.id);
            }
        });*/
    });

function submitTokenToServer(token) {
    url = $('#planForm').attr('action');
    var formData = new FormData($('#planForm')[0]);

    uploadajax(url, formData, 'post', '', 'json', function(output) {
        if (output.success) {
               
                $('#thank_you_msg').modal('show');
            }else{
                $('#card-errors').text(output.message).show();
            }
    });
}

</script>
@endpush