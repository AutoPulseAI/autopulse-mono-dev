@extends('layouts.front')

@section('content')
<main class="page-wrapper rbt-dashboard-page">
    <div class="rbt-panel-wrapper">
        @include('template.dealers.include.header')
        @include('template.dealers.include.mobilemenu')
        @include('template.dealers.include.sidebar')

        @php
            $user = Auth::guard('dealer')->user();  
        @endphp

        <div class="rbt-main-content mr--0 mb--0">
            <div class="rbt-daynamic-page-content center-width">
                <div class="rbt-dashboard-content">
                    <div class="banner-area">
                        <div class="settings-area mb-0">
                            <h3 class="title">Leads</h3>
                        </div>

                        <!-- Filter -->
                        <div class="rbt-dashboard-content px-0">
                            <div class="row justify-content-center">
                                <div class="col-lg-12 col-md-12 col-12">
                                    <form method="GET" action="{{ route('dealer.mylead') }}" class="rbt-profile-row rbt-default-form row justify-content-center gx-2 w-100">
                                        <!--div class="col-lg-3 col-md-4 col-12">
                                            <input type="text" name="search" class="form-control" placeholder="Search by Name, Email, VIN" value="{{ request()->get('search') }}">
                                        </div-->
                                        <div class="col-xxl-3 col-lg-4 col-md-5 col-12">
                                            <div class="form-group d-flex align-items-center mb-3">
                                                <span>From:</span>&nbsp;
                                                <input type="date" name="from" class="ms-auto ms-md-1" value="{{ request()->get('from') }}">
                                            </div>
                                        </div>
                                        <div class="col-xxl-3 col-lg-4 col-md-4 col-12">
                                            <div class="form-group d-flex align-items-center mb-3">
                                                <span>To:</span>&nbsp;
                                                <input type="date" name="to" class="ms-auto ms-md-1" value="{{ request()->get('to') }}"> 
                                            </div>
                                        </div>
                                        <div class="col col-lg-1 col-md-1 col-4">
                                            <button type="submit" class="btn-default w-100 mb-3" value="Filter"><i class="fa-solid fa-magnifying-glass"></i></button>
                                        </div>
                                        <div class="col col-lg-1 col-md-1 col-4">
                                            <a href="{{ route('dealer.mylead') }}" class="react-btn btn-default btn-border w-100 mb-3"><i class="fa-solid fa-arrow-rotate-right"></i></a>
                                        </div>
                                        <div class="col col-lg-1 col-md-1 col-4">
                                            <a href="{{ route('dealer.export.leads', request()->all()) }}" class="react-btn btn-default btn-border w-100 mb-3"><i class="fa-solid fa-download"></i></a>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>

                    </div>
                    <div class="content-page pb--50">
                        <div class="row row--15">
                            <div class="col-lg-12">                                
                                <div class="rainbow-compare-table style-1 table-responsive">
                                    <table class="table-responsive">
                                        <thead>
                                            <tr>
                                                <th class="sm-radius-top-left">Car</th>
                                                <th class="sm-radius-top-left">Vin</th>
                                                <th class="style-prymary">Name</th>
                                                <th class="style-prymary">Zip</th>
                                                <th class="style-prymary">Email</th>
                                                <th class="style-prymary">Phone</th>
                                                <th class="sm-radius-top-right">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody>       
                                            @forelse ($vehicles as $item)
                                                <tr>
                                                    <td>{{ $item['make'] ?? '' }} {{ $item['model'] ?? '' }} {{ $item['year'] ?? '' }}</td>
                                                    <td>{{ $item['vin'] ?? '' }}</td>
                                                    <td>{{ $item['user']['name'] ?? '' }}</td>
                                                    <td>{{ $item['user']['zip_code'] ?? '' }}</td>
                                                    <td>{{ $item['user']['email'] ?? '' }}</td>
                                                    <td>{{ $item['user']['phone_number'] ?? '' }}</td>
                                                    <td class="text-nowrap">{{ $item['created_at'] ? $item['created_at']->format('Y-m-d') : '' }}</td>
                                                </tr>
                                            @empty
                                                <tr>
                                                    <td colspan="7" class="text-center">No Record found.</td>
                                                </tr>
                                            @endforelse
                                        </tbody>
                                    </table>
                                    <div class="pagination-wrapper convpage mt-3">
                                        {{ $vehicles->onEachSide(1)->links('pagination::bootstrap-5') }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>

<!-- Start Modal  -->
<div id="editStoreSubscrip" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl modal-small text-center">
            <p class="b1 text-center mb--0">Kindly contact on <b><a class="text_dark" href="mailto:info@autopulse.ai">info@autopulse.ai</a></b> regarding your subscription!</p>
            <div class="bottom-btn mt--20 w-100">
                <button data-bs-dismiss="modal" class="btn-default btn-border btn-small round">Cancel</button>
                <button type="button" class="btn-default btn-small round" id="contactNowButton">OK</button>
            </div>
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End Modal  -->

<!-- Start Modal  -->
<div id="cancelSubscriptionModal" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl modal-small">
            <form id="cancelSubscriptionForm" method="POST" action="{{ route('create_cancel_request') }}" class="rbt-profile-row rbt-default-form row row--15">
                @csrf    
                <div class="col-12">
                    <div class="form-group">
                        <label>Reason for cancellation</label>
                        <textarea id="cancel_reason" name="reason" required cols="20" rows="4"></textarea>
                    </div>
                </div>
                <div class="col-12">
                    <div class="bottom-btn w-100 text-center">
                        <button data-bs-dismiss="modal" class="btn-default btn-border btn-small round">Cancel</button>
                        <button type="submit" class="btn-default btn-small round">Submit</button>
                    </div>
                </div>
            </form>
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End Modal  -->

@endsection

@push('after-scripts')
<script>
$('#contactNowButton').click(function() {
    $('#editStoreSubscrip').modal('hide');
    $('#cancelSubscriptionModal').modal('show');
});

$('#editStoreSubscrip').on('show.bs.modal', function (event) {
    var button = $(event.relatedTarget);
    var storeId = button.data('id');
    $('#cancel_store_id').val(storeId);
});

$('#cancelSubscriptionForm').submit(function(e){
    e.preventDefault();
    $('#cancelSubscriptionForm button[type="submit"]').text('Please wait...').attr('disabled', 'disabled');
    
    if ($('#cancelSubscriptionForm').valid()) {    
        var url = `{{ route('create_cancel_request') }}`;
        var formData = new FormData($('#cancelSubscriptionForm')[0]);
        
        $.ajax({
            url: url,
            method: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(output) {
                $('#cancelSubscriptionForm button').text('Submit').removeAttr('disabled');
                if (output.success) {
                    $('.modal').modal('hide');
                    $('.successmsgdiv').html(output.message)
                    $('#thank_you').modal('show');
                } else {
                    alert("An error occurred.");
                }
            },
            error: function() {
                $('#cancelSubscriptionForm button').text('Submit').removeAttr('disabled');
                alert("An error occurred while submitting.");
            }
        });
    } else {
        $('#cancelSubscriptionForm button').text('Submit').removeAttr('disabled');
    }
});
</script>
@endpush
