@extends('layouts.dealer')
 
@section('content')

<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
            
            </div>
            <div class="col col-lg-9 col-12">
                <!-- Vehicles Of Interest -->
                @php
                    $user = Auth::guard('dealer')->user();  
                    use Carbon\Carbon;
                @endphp
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>Subscription Plan</h3>
                                    </div>
                                </div>
                            </div>
                            @if($user && !$user->email_verified_at)
                                <div class="alert alert-danger" role="alert">
                                    Your email address is not verified. Please verify it to access all features. <a href="{{route('dealer.sendverify')}}"> Send Verification Mail </a>
                                </div>
                            @endif
                            @if (session('success'))
                                <div class="alert alert-success">
                                    {{ session('success') }}
                                </div>
                            @endif

                            @if (session('error'))
                                <div class="alert alert-danger">
                                    {{ session('error') }}
                                </div>
                            @endif
                        </div>
                    </div>
                    
                    <div class="position-relative subscription_plans">
                        <div class="row">
                            @foreach ($plans as $plan)
                           
                            @php 
                            $discount =0;
                                if($plan->name=='Monthly'){
                                    $name ='/Monthly';
                                  
                                }
                                if($plan->name=='Quarterly'){
                                    $name = '/Quarterly' ;
                                    $discount = 599*3 ;
                                }
                                if($plan->name=='Free'){
                                    $name = '' ;
                                }
                            @endphp



                                <div class="col col-md-4 col-12">
                                    <div class="subs_card">
                                        <!-- Plan -->
                                        <div class="subs_plan_head">
                                            <h2>{{ $plan->name }}</h2>
                                        </div>
                                        <!-- Description -->
                                        <div class="subs_plan_desc">
                                            <!--p>Lorem ipsum dolor, sit amet consectetur adipisicing elit.</p-->
                                        </div>
                                        <hr>
                                        <!-- Features -->
                                        <div class="subs_plan_features featureCollapse" style="height: 340px;">
                                            <div class="subs_plan_features_inn">
                                           
                                            {!! $plan->description !!}
                                            </div>
                                            <a class="toggleButton">More..</a>
                                        </div>
                                        <!-- Price -->
                                        <div class="subs_plan_price">
                                            <h3>${{ number_format($plan->price) }}<span class="mx-2">@if($discount>0)<del>${{ number_format(( $discount )) }}</del> @endif</span><span>{{$name}}</span></h3>
                                        </div>
                                        <!-- Button and Subscription Info -->
                                        @if ($plan->price>0)
                                            @if ($subscription && $subscription->stripe_price == $plan->stripe_price_id)
                                                @if (!$subscription->canceled())
                                                    {{-- If the subscription is active and not canceled --}}
                                                
                                                    <a href="javascript:;" onclick="cancelpopup('{{ route('dealer.add_payment_method', ['plan_id' => $plan->id]) }}')" class="btn btn_theme w-100">Cancel Now</a>
                                                    <p class="small text-muted pt-2 text-center w-100 mb-0">
                                                        Next Payment on: {{ Carbon::createFromTimestamp($subscription->asStripeSubscription()->current_period_end)->toFormattedDateString() }}
                                                    </p>
                                                @else
                                                    {{-- If the subscription is canceled but still in the grace period --}}
                                                
                                                    <a href="javascript:;" onclick="showpopup('{{ route('dealer.add_payment_method', ['plan_id' => $plan->id]) }}','{{$plan->id}}')" class="btn btn_theme w-100">Renew Now</a>
                                                    <p class="small text-muted pt-2 text-center w-100 mb-0">
                                                        Ends on: {{ $subscription->ends_at->toFormattedDateString() }}
                                                    </p>
                                                @endif
                                            @else
                                                <a href="javascript:;" onclick="showpopup('{{ route('dealer.add_payment_method', ['plan_id' => $plan->id]) }}','{{$plan->id}}')" class="btn btn_theme w-100">Subscribe Now</a>
                                            @endif
                                        @else

                                        @endif
                                        
                                    </div>
                                </div>
                            @endforeach
                        </div>

                            
                        
                    </div>

                </div>
                

                
            </div>

        </div>
    </div>

</section>

  <!-- Success Modal -->
@if($paymentMethod && $paymentMethod->id )
<form sytle="display:none;" id="paymentform" action ="{{route('subscribe.process.ajax') }}">
    @csrf
    <input name="token" type="hidden" id="token" value="{{ $paymentMethod->id}}">
    <input name="plan_id" type="hidden" id="myplan_id" value="">
</form>
@endif
<div class="modal fade" id="paymentMethodConfirmationModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-body">
                <div class="position-relative logout_confirmation_modal">
                    <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                    <div class="row">
                        <div class="col col-12">
                            <div class="position-relative">
                                <div class="modal_heading">
                                    <h3>Payment</h3>
                                </div>

                                <div class="position-relative logout_icon_text mb-3 mt-4">
                                    <p>Please add your card to continue your subscription.</p>
                                </div>        
                                
                                <div class="position-relative text-center mb-3">
                                    @if($paymentMethod && $paymentMethod->id )
                                        <a id="defaultcard" href="update-payment-method.php"  /*onclick ="makepayment('{{ $paymentMethod->card->last4 }}')"*/ id="plan_id" class="btn btn_secondary_light"><i class="fas fa-check-circle me-2"></i>XXXX -XXXX-XXXX-{{ $paymentMethod->card->last4 }}</a>
                                        <div id="card-errors" role="alert" class="py-2"></div>
                                        <div class="position-relative">
                                            <p><small>Or</small></p>
                                        </div>
                                    @else
                                        <a data-bs-dismiss="modal" class="btn btn_secondary_light">No</a>
                                    @endif
                                    <a id="addcard" href="update-payment-method.php" class="btn btn_theme_light">Add Card</a>                                    
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    </div>
</div>


<div class="modal fade" id="cancelSubscription" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-body">
                <div class="position-relative logout_confirmation_modal">
                    <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                    <div class="row">
                        <div class="col col-12">
                            <div class="position-relative">
                                <div class="modal_heading">
                                    <h3>Confirm</h3>
                                </div>

                                <div class="position-relative logout_icon_text mt-4">
                                    <p>Are you sure you want to cancel this plan</p>
                                </div>        
                                
                                <div class="position-relative text-center mb-3">
                                    <a  href="{{ route('dealer.cancelsubscription') }}" class="btn btn_theme_light">Cancel</a>
                                    
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    </div>
</div>


<div class="modal fade" id="proceednext" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-body">
                <div class="position-relative logout_confirmation_modal">
                    <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>

                    <div class="row">
                        <div class="col col-12">
                            <div class="position-relative">
                                <div class="modal_heading">
                                    <h3>Confirm</h3>
                                </div>

                                <div class="position-relative logout_icon_text mt-4">
                                    <p id="confirm_msg_alert">Are you sure you want to Procedd this plan</p>
                                    <p>Are you sure you want to Procedd this plan</p>
                                </div>        
                                
                                <div class="position-relative text-center mb-3">
                                    <a onclick="makepayment(0,1)" href="javascript:;" onclick="" class="btn btn_theme_light">Confirm</a>
                                    
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    </div>
</div>
<!-- Success Modal -->
<div class="modal fade" id="thank_you_msg" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title text-success" id="exampleModalLabel">Success</h5>
               
            </div>
            <div class="modal-body">
                Your subscription has been processed successfully. Click Ok to move to Home page
            </div>
            <div class="modal-footer">
                <a href="{{route('dealer.subscription')}}" class="btn btn-secondary" >OK</a>
            </div>
        </div>
    </div>
</div>


@endsection

@push ('after-scripts')

<script>


function showpopup(weburl,plan_id)
{
   
    $('#addcard').attr('href',weburl);
    $('#defaultcard').attr('href',weburl+'&paymentmethod=1');
    
    $('#paymentMethodConfirmationModal').modal('show');
    $('#myplan_id').val(plan_id);
}
function cancelpopup(weburl)
{
   // $('#addcard').attr('href',weburl);
    $('#cancelSubscription').modal('show');
}
function makepayment(id,check=0)
{
   

    if(check==0){
        url = `{{ route('subscribe.checkPlan')}}`;
    }else{
        url = $('#paymentform').attr('action');
    }
    var formData = new FormData($('#paymentform')[0]);
    uploadajax(url, formData, 'post', '', 'json', function(output) {
        if(check==0){
            if (output.success) {
                makepayment(0,1)
               
            }else{
                if(output.data.status ==0)
                    $('#card-errors').text(output.message).show();
                else{
                    $('#confirm_msg_alert').text(output.message);
                    $('#thank_you_msg').modal('hide');
                    $('#proceednext').modal('show');
                }
            }
           
        }else{
            if (output.success) {
               
               $('#thank_you_msg').modal('show');
           }else{
               $('#card-errors').text(output.message).show();
           }
         
        }
    });
}
</script>
@endpush