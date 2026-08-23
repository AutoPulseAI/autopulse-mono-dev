@extends('layouts.admin')

@section('content')
<input type="hidden" id="seturl" value="">
<div class="position-relative">
    <div class="row">
        <div class="col col-xl-3 col-lg-12 col-md-12 col-12">
            <div class="page_title mb-3">
                <h2>Manage Transactions</h2>
            </div>
        </div>
        <div class="col col-xl-9 col-lg-12 col-md-12 col-12">
            <div class="position-relative">
                <div class="row gx-1 justify-content-end"> 
                    <div class="col col-lg-11 col-md-11 col-12">
                        <form id="userFilter" method="GET" class="row gx-1">
                            <div class="col col-lg-4 col-md-4 col-12">
                                <select class="form-select w-100" name="transaction_type" id="subscriptionTypeSelect">
                                    <option value="">Select Subscription Type</option>
                                    <option value="1">Automated</option>
                                    <option value="0">Manual Payment</option>
                                </select>
                            </div>
                            <label class="col col-lg-3 col-md-4 col-12 d-flex align-items-center">
                                From:&nbsp;<input type="date" id="transaction-from" name="from" class="form-control form-control-sm me-md-1" value="{{Request::get('from')}}"> 
                            </label>
                            <label class="col col-lg-3 col-md-4 col-12 d-flex align-items-center">
                                To:&nbsp;<input type="date" id="transaction-to" name="to" class="form-control form-control-sm" value="{{Request::get('to')}}">
                            </label>
                            <div class="col col-lg-1 col-md-2 col-6">
                                <button type="submit" class="btn btn_theme w-100 px-1" id="filterButton">Submit</button>
                            </div>
                            <div class="col col-lg-1 col-md-2 col-6">
                                <a href="{{ route('admin.transaction') }}" class="btn btn_theme w-100 px-1">Reset</a>
                            </div>
                        </form>
                    </div>
                    <div class="col col-lg-1 col-md-1 col-6">
                        <button id="downloadCSV" class="btn btn_dark w-100"><i class="fas fa-download me-2"></i>CSV</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10" data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif

    <div class="tab_box">
        <!-- Nav pills -->
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" data-bs-toggle="pill" href="#transactionsList">All Transactions</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" data-bs-toggle="pill" href="#transactionForm">Add Transaction</a>
            </li>
        </ul>

        <!-- Tab panes -->
        <div class="tab-content">
            <!-- All Transactions -->
            <div id="transactionsList" class="tab-pane active">
                <div class="position-relative table-responsive pt-2" style="min-height: 300px;">
                    <table class="table table-bordered w-100 dataTable" id="transaction_table">
                        <thead>
                            <tr>
                                <td>#</td>
                            
                                <td>Dealership Name</td>
                             
                                <td>Subscription Start Date</td>
                                <td>Subscription End Date</td>
                                <td>Amount</td>
                                <td>Paid Amount</td>
                                <td>Coupon Code</td>
                                <td>Coupon Amount</td>
                                <td>Subscription Type</td>
                                <!-- <td>Action</td> -->
                            </tr>
                        </thead>
                    </table>
                </div>
            </div>

            <!-- Transaction Form Tab -->
            <div id="transactionForm" class="tab-pane fade">
                <div class="row justify-content-center mt-3 mx-md-3 mx-0">
                    <div class="col col-xl-7 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <form id="addTransaction" class="gx-3 gy-2" method="POST" action="{{ route('admin.transaction.add') }}">
                                @csrf
                                <div class="tab_box_form border bg-transparent rounded">
                                    <div class="row gx-2">
                                        <div class="col col-md-6 col-12">
                                            <select class="form-select" id="store_id" name="store_id" required>
                                                <option selected disabled>Select Store</option>
                                                @foreach($stores as $store)
                                                    <option value="{{ $store->id }}">{{ $store->dealership_name }}</option>
                                                @endforeach
                                            </select>
                                        </div>
                                        <div class="col col-md-6 col-12">
                                            <input type="number" step="0.01" class="form-control" id="total_amount" name="total_amount" placeholder="Total Amount" required>
                                        </div>
                                        <div class="col col-md-6 col-12">
                                            <label class="form-label mt-2"><small>Subscription Start Date:</small></label>
                                            <input type="date" class="form-control" id="subscription_start_date" name="subscription_start_date" placeholder="Subscription Start Date" required>
                                        </div>
                                        <div class="col col-md-6 col-12">
                                            <label class="form-label mt-2"><small>Subscription End Date:</small></label>
                                            <input type="date"  class="form-control" id="subscription_end_date" name="subscription_end_date" placeholder="Subscription End Date" required>
                                        </div>
                                    </div>
                                </div>
                                <div class="row justify-content-center">
                                    <div class="col col-lg-2 col-md-3 col-12">
                                        <div class="position-relative text-center mt-3">
                                            <button type="submit" class="btn btn_theme w-100">Submit</button> 
                                        </div>
                                    </div>
                                </div>
                            </form>
                            <div id="errorMessages" class="mt-3"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Edit Transaction Modal -->
<div class="modal fade" id="editTransaction" tabindex="-1" aria-labelledby="editTransactionLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Edit Transaction Details</b></h5>

                    <!-- Form -->
                    <form id="editTransactionForm" method="POST" action="{{ route('admin.transaction.update') }}" class="gx-3 gy-2">
                        @csrf    
                        <input type="hidden" id="edit_transaction_id" name="transaction_id">
                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <select class="form-select" id="edit_store_id" name="store_id" required>
                                    @foreach($stores as $store)
                                        <option value="{{ $store->id }}">{{ $store->dealership_name }}</option>
                                    @endforeach
                                </select>
                            </div>
                            <div class="col col-12">
                                <input type="number" step="0.01" class="form-control" id="edit_total_amount" name="total_amount" placeholder="Total Amount" required>
                            </div>
                            <div class="col col-12">
                                <input type="number" step="0.01" class="form-control" id="edit_coupon_amount" name="coupon_amount" placeholder="Coupon Amount" required>
                            </div>
                            <div class="col col-12">
                                <input type="text" class="form-control" id="edit_coupon_code" name="coupon_code" placeholder="Coupon Code" required>
                            </div>
                            <div class="col col-12">
                                <input type="date" class="form-control" id="edit_subscription_start_date" name="subscription_start_date" placeholder="Subscription Start Date" required>
                            </div>
                            <div class="col col-12">
                                <input type="date" class="form-control" id="edit_subscription_end_date" name="subscription_end_date" placeholder="Subscription End Date" required>
                            </div>
                            <div class="col col-12">
                                <select class="form-select" id="edit_transaction_type" name="transaction_type" required>
                                    <option value="">Select Subscription Type</option>
                                    <option value="0">Default</option>
                                    <option value="1">Manual Payment</option>
                                </select>
                            </div>
                        </div>
                        <div class="row gx-2">
                            <div class="col col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-6">
                                <button type="submit" class="btn btn_theme w-100">Update Details</button> 
                            </div> 
                        </div> 
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Delete Transaction Modal -->
<div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0">
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body pb-4">
                <div class="position-relative text-center">
                    <i class="fa-light fa-circle-xmark fa-3x mb-3 text-danger"></i>
                    <h5 class="mb-4">Are you sure you want to delete this transaction?</h5>
                    <div class="position-relative text-center">
                        <div class="row justify-content-center gx-2">
                            <div class="col col-lg-3 col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-lg-3 col-6">
                                <button type="button" class="btn btn_theme w-100" onclick="actionmethod()">Yes</button> 
                            </div> 
                        </div> 
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
@endsection

@section('script')

<script type="text/javascript">
var page = '';
var myurl = '{{ route('admin.transaction.data') }}';

page = $('#transaction_table').DataTable({
    processing: true,
    serverSide: true,
    responsive: true,
    ajax: {
        url: myurl,
        type: 'GET',
        data: function(d) {
            d.dealership_group = $('#dealership_group').val();
            d.transaction_type = $('#subscriptionTypeSelect').val();
            d.start_date = $('#transaction-from').val();
            d.end_date = $('#transaction-to').val();
        }
    },
    columns: [
        { data: 'id', name: 'id' },
     
        { data: 'store.dealership_name', name: 'store.dealership_name' },
     
        { data: 'subscription_start_date', name: 'subscription_start_date' },
        { data: 'subscription_end_date', name: 'subscription_end_date' },
        { data: 'total_amount', name: 'total_amount' },
        {
            data: 'discount_amount',
            name: 'discount_amount',
            render: function(data, type, row) {
                // Ensure that both `total_amount` and `discount_amount` exist in the row
                if (row.total_amount && row.discount_amount) {
                    return row.total_amount - row.discount_amount;
                }
                // If one of them is missing, return a fallback (e.g., 0)
                return row.total_amount;
            }
        },
        { data: 'coupon_code', name: 'coupon_code' },
        { data: 'coupon_amount', name: 'coupon_amount' },
        { 
            data: 'transaction_type', 
            name: 'transaction_type',
            render: function(data, type, row) {
                return data == 1 ? 'Automatic' : 'Manual';
            }
        },
        // {
        //     data: null,
        //     orderable: false,
        //     searchable: false,
        //     render: function (data, type, row) {
        //         var transaction = JSON.stringify(row);
                
        //         var editButton = `<a class="dropdown-item" href="javascript:" data-bs-toggle="modal" data-bs-target="#editTransaction" data-transaction='${transaction}' onclick="setEditData(this)">Edit</a>`;
        //         //var deleteButton = `<a class="dropdown-item" href="javascript:" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('{{ route('admin.transaction.delete') }}?transaction_id=${row.id}')">Delete</a>`;
        //         editButton =''
        //         var actionDots = `<div class="table_action dropdown">
        //                                 <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
        //                                 <ul class="dropdown-menu">
        //                                     <li>`+editButton+`</li>
                                           
        //                                 </ul>
        //                             </div>`;
        //         return actionDots;
        //     },
        // },
    ],
    language: {
        paginate: {
            first: 'First',
            last: 'Last',
            next: '&rarr;',
            previous: '&larr;',
        },
        lengthMenu: 'Show <select>' +
            '<option value="1" selected>1</option>' +
            '<option value="2">2</option>' +
            '<option value="3">4</option>' +
            '<option value="4">6</option>' +
            '<option value="-1">All</option>' +
            '</select> records',
        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoFiltered: '(filtered from _MAX_ total records)',
    },
});

$.ajaxSetup({
    headers: {
        'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
    }
});

function setEditData(buttonElement) {
    var transaction = JSON.parse($(buttonElement).attr('data-transaction'));
    $('#edit_transaction_id').val(transaction.id);
    $('#edit_store_id').val(transaction.store_id);
    $('#edit_total_amount').val(transaction.total_amount);
    $('#edit_coupon_amount').val(transaction.coupon_amount);
    $('#edit_coupon_code').val(transaction.coupon_code);
    $('#edit_subscription_start_date').val(transaction.subscription_start_date);
    $('#edit_subscription_end_date').val(transaction.subscription_end_date);
    $('#edit_transaction_type').val(transaction.transaction_type);
}

$('#addTransaction').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');

        var formData = $(this).serialize();
        var url = $(this).attr('action');

        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Submit');
            if (output.success) {
                window.location.reload();
                page.ajax.reload();
            } else {
                for (var key in output.data) {
                    existvalue = $('#' + key).val();
                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[key][0]));
                    jQuery('#' + key).addClass(key + "error");
                    jQuery('#' + key).valid();
                }
            }
        });
    }
});

$('#editTransactionForm').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');

        var formData = $(this).serialize();
        var url = $(this).attr('action');

        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Update Details');
            if (output.success) {
                $('#editTransaction').modal('hide');
                page.ajax.reload();
            } else {
                for (var key in output.data) {
                    existvalue = $('#edit_' + key).val();
                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[key][0]));
                    jQuery('#edit_' + key).addClass(key + "error");
                    jQuery('#edit_' + key).valid();
                }
            }
        });
    }
});

function seturl(url) {
    document.getElementById('seturl').value = url;
}

function actionmethod() {
    let url = document.getElementById('seturl').value;
    runajax(url, {}, 'GET', '', 'json', function(output) {
        if (output.success) {
            $('#deleteModal').modal('hide');
            page.ajax.reload();
        }
    });
}

$('#userFilter').on('submit', function(event) {
    event.preventDefault();
    page.ajax.reload();
});

$('#downloadCSV').on('click', function() {
    var dealership_group = $('#dealership_group').val();
    var transaction_type = $('#subscriptionTypeSelect').val();
    var from = $('#transaction-from').val();
    var to = $('#transaction-to').val();

    var queryParams = $.param({
        dealership_group: dealership_group,
        transaction_type: transaction_type,
        start_date: from,
        end_date: to
    });

    window.location.href = '{{ route('admin.transaction.csv') }}?' + queryParams;
});
</script>

@endsection
