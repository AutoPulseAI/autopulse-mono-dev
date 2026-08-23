@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">

<div class="position-relative">
    <div class="row gx-2">
        <div class="col col-md-12 col-12 page_title">
            <div class="page_title mb-3">
                <h2>Manage Cancellation</h2>
            </div>
        </div>
        <div class="col col-lg-8 col-md-12 col-12">
            <div class="position-relative">
                <!--form id="searchForm" class="row gx-1 justify-content-md-end">
                    <div class="col col-lg-3 col-md-3 col-12 ">
                        <div class="position-relative">
                            <select class="form-select w-100" name="dealer_id" id="dealerGroupSelect">
                                <option value="">Select Dealer Group</option>
                                @foreach($dealerGroup as $key => $value)
                                    @if($value->dealership_group )
                                    <option value="{{ $value->id }}">{{ $value->dealership_group }}</option>
                                    @endif
                                @endforeach
                            </select>
                        </div>                        
                    </div>
                    <div class="col col-lg-3 col-md-3 col-12 ">
                        <select class="form-select w-100" name="is_manage_by_admin" id="subscriptionTypeSelect">
                            <option value="">Subscription Type</option>
                            <option value="0">Default</option>
                            <option value="1">Manual</option>
                        </select>
                    </div>
                    <div class="col col-lg-2 col-md-2 col-12 ">
                        <select class="form-select w-100" name="is_subscribed" id="isSubscribedSelect">
                            <option value="">Subscribed</option>
                            <option value="0">Not Subscribed</option>
                            <option value="1">Subscribed</option>
                        </select>
                    </div>
                    <div class="col col-lg-2 col-md-2 col-6 ">
                        <button type="submit" class="btn btn_theme w-100">Search</button>
                    </div>
                    <div class="col col-lg-2 col-md-2 col-6 ">
                        <a href="{{ route('admin.cancellation.request.list') }}" class="btn btn_theme w-100">Reset</a>
                    </div>
                </form-->
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
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" data-bs-toggle="pill" id="storelistall" href="#storesList">All Cancellation Reqeust</a>
            </li>
            
        </ul>

        <div class="tab-content">
            <div id="storesList" class="tab-pane active">
                <div class="position-relative table-responsive pt-2" style="min-height: 300px;">
                    <table class="table table-bordered w-100 dataTable" id="store_tabl">
                        <thead>
                            <tr>
                                <td>#</td>
                             
                                <td>Dealership Store</td>
                                <td>Dealership Website</td>
                                <td>Reason</td>
                                <td>Subscription Status</td>
                                <td>Action</td>
                            </tr>
                        </thead>
                        <tbody>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="storesForm" class="tab-pane fade">
               
            </div>
        </div>
    </div>

    <!-- Approve Modal -->
    <div class="modal fade" id="approveModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header border-0">
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body pb-4">
                    <div class="position-relative text-center">
                        <i class="fa-light fa-circle-check fa-3x mb-3 text-white"></i>
                        <h5 class="mb-4">Are you sure you want to approve?</h5>
                        <div class="position-relative text-center">
                            <div class="row justify-content-center gx-2">
                                <div class="col col-lg-3 col-6">
                                    <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button>
                                </div>
                                <div class="col col-lg-3 col-6">
                                    <button type="button" id="confirmApprove" class="btn btn_theme w-100">Yes</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Reject Modal -->
    <div class="modal fade" id="rejecteModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header border-0">
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body pb-4">
                    <div class="position-relative text-center">
                        <i class="fa-light fa-circle-xmark fa-3x mb-3 text-white"></i>
                        <h5 class="mb-4">Are you sure you want to reject?</h5>
                        <div class="position-relative text-center">
                            <div class="row justify-content-center gx-2">
                                <div class="col col-lg-3 col-6">
                                    <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button>
                                </div>
                                <div class="col col-lg-3 col-6">
                                    <button type="button" id="confirmreject" class="btn btn_theme w-100">Yes</button>
                                </div>
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
<script>
   
    var storeTable = $('#store_tabl').DataTable({
        processing: true,
        serverSide: true,
        order: [[0, 'desc']], 
        ajax: {
            url: '{{ route('cancellation.request.data') }}',
            type: 'GET',
            data: function (d) {
                d.dealer_id = $('#dealerGroupSelect').val();
                d.is_manage_by_admin = $('#subscriptionTypeSelect').val();
                d.is_subscribed = $('#isSubscribedSelect').val();
            }
        },
        columns: [
            { data: 'id', name: 'id' },
            { data: 'store.dealership_name', name: 'store.dealership_name' },
            { data: 'store.source', name: 'store.source' },
            { data: 'reason', name: 'reason' },
            { data: 'status', name: 'status' },
            {
                data: null,
                orderable: false,
                searchable: false,
                render: function (data, type, row) {
                    var cancelsubscritpion='';
                    var reject = `<a class="dropdown-item editDealer" data-id="` + row.id + `" data-bs-toggle="modal" data-bs-target="#approveModal">Approve</a>`;
                    var approve = `<a class="dropdown-item" data-id="` + row.id + `" data-bs-toggle="modal" data-bs-target="#rejecteModal">Reject</a>`;
                   
                    return `
                        <div class="table_action dropdown">
                            <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                            <ul class="dropdown-menu">
                                <li>` + reject + `</li>
                                <li>` + approve + `</li>
                            </ul>
                        </div>
                    `;
                },
            },
        ],
    });

    $('#searchForm').on('submit', function (e) {
        e.preventDefault();
        storeTable.draw();
    });

    $('#confirmApprove').on('click', function () {
        var id = $('#approveModal').data('id');
        data = {'id':id};
        runajax('{{ route('admin.request.approve') }}', data, 'get', '', 'json', function(output) {
            storeTable.ajax.reload();
            $('#approveModal').modal('hide');
        });
    });

    $('#confirmreject').on('click', function () {
        var id = $('#rejecteModal').data('id');
        data = {'id':id};
        runajax('{{ route('admin.request.reject') }}', data, 'get', '', 'json', function(output) {
            storeTable.ajax.reload();
            $('#rejecteModal').modal('hide');
        });
    });

    $('#approveModal').on('show.bs.modal', function (e) {
        var button = $(e.relatedTarget);
        var id = button.data('id');
        $('#approveModal').data('id', id);
    });
    
    $('#rejecteModal').on('show.bs.modal', function (e) {
        var button = $(e.relatedTarget);
        var id = button.data('id');
        $('#rejecteModal').data('id', id);
    });
</script>
@endsection
