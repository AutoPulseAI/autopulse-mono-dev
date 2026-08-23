@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
 
    <div class="row">
        <div class="col col-xl-4 col-lg-12 col-md-12 col-12">
            <div class="page_title mb-3 mb-xl-0">
                <h2>Total Leads</h2>
            </div>
        </div>
        <div class="col col-xl-8 col-lg-12 col-md-12 col-12">
            <div class="position-relative">
                <div class="row gx-1 justify-content-end">
                    <div class="col col-lg-10 col-md-11 col-12">
                        <form action="" id="filter-form" method="GET" class="row gx-1">
                            <label class="col col-lg-4 col-md-4 col-12 d-flex align-items-center">
                                From:&nbsp;<input type="date" name="from" class="form-control form-control-sm me-md-1" value="{{Request::get('from')}}">
                            </label>
                            <label class="col col-lg-4 col-md-4 col-12 d-flex align-items-center">
                                To:&nbsp;<input type="date" name="to" class="form-control form-control-sm" value="{{Request::get('to')}}">
                            </label>
                            <div class="col col-lg-2 col-md-2 col-6">
                                <button type="submit" class="btn btn_theme w-100">Filter</button>
                            </div>
                            <div class="col col-lg-2 col-md-2 col-6">
                                <a href="{{ route('lead.index') }}" class="btn btn_theme w-100">Reset</a>
                            </div>
                        </form>
                    </div>
                    <div class="col col-lg-2 col-md-1 col-6">
                        <button type="button" id="download-csv" class="btn btn_dark w-100 mt-0"><i class="fas fa-download me-2"></i>CSV</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="tab_box py-3">
        <div class="row">
            
            <div class="col col-12">
                <div class="position-relative table-responsive">
                    <table class="table table-bordered w-100 dataTable" id="contact_tabl">
                        <thead>
                            <tr>
                                <td>#</td>
                                <td>VIN</td>
                                <td>Dealer Name</td>
                                <td>Name</td>
                                <td>Zip</td>
                                <td>Email</td>
                                <td>Phone</td>                            
                                <td>Date</td>
                                <td>Action</td>
                            </tr>
                        </thead>
                    </table>

                </div>
            </div>
        </div>
    </div>

    <!-- View Info Modal -->
<div class="modal fade" id="showModal" tabindex="-1" aria-labelledby="viewScriptLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>See Information about contact</b></h5>

                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">VIN:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-vin"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Dealership Name:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-dealername"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Dealership Phone:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-dealerphone"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Website:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-website"></div>
                    </div>
                    
                    <h5 class="modal-title text_primary mb-3 mt-4 mt-lg-5"><b>Request Info</b></h5>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Name:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-user_name"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Zip:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-user_zip"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Phone:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-userphone"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Email:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-dealeremail"></div>
                    </div>
                    <hr>
                    
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Created At:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-created_at"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Delete Modal -->
<div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0">
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body pb-4">
                <div class="position-relative text-center">
                    <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-white"></i>
                    <h5 class="mb-4">Are you sure you want to delete this record?</h5>
                    <div class="position-relative text-center">
                        <div class="row gx-2">
                            <div class="col col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-6">
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
<script>
var contact ='';
var myurl = '{{route('lead.tableData')}}';

$(function () {

    $('body').on('click', '.showContact', function () {
        var contact_id = $(this).data('id');
        $.get("{{ route('lead.view') }}" +'?id=' + contact_id , function (data) {
            $('#showModal').modal('show');

            $('#contact-vin').text(data.vin ? data.vin : '');
            $('#contact-dealername').text(data.dealer ? (data.dealer.name ) : '');
            $('#contact-dealerphone').text(data.dealer ? data.dealer.phone_number : '');
            $('#contact-dealeremail').text(data.dealer ? data.dealer.email : '');

            $('#contact-user_name').text(data.user ? data.user.name:'' );
            $('#contact-user_zip').text(data.user ? data.user.zip_code:'' );
            $('#contact-userphone').text(data.user ? data.user.phone_number : '');
            $('#contact-usereremail').text(data.user ? data.user.email : '');
            $('#contact-website').text(data.dealer_source ? data.dealer_source : '');
            $('#contact-created_at').text(data.created_at ? data.created_at : '');

            
        });
    });

});
$('#filter-form').on('submit', function(e) {
        e.preventDefault();
        contact.ajax.reload();
    });
$('#download-csv').on('click', function() {
    var from = $('input[name="from"]').val();
    var to = $('input[name="to"]').val();
 
    var form = $('<form>', {
        action: '{{ route('lead.download') }}',
        method: 'GET',
        class: 'd-none'
    }).append($('<input>', { type: 'hidden', name: 'export', value: '' }))
       
        .append($('<input>', { type: 'hidden', name: 'from', value: from }))
        .append($('<input>', { type: 'hidden', name: 'to', value: to }));

    $('body').append(form);
    form.submit();
    form.remove();
});
function getQueryParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            from: params.get('from'),
            to: params.get('to')
        };
    }

    // Set form values from query parameters
    const queryParams = getQueryParams();
    if (queryParams.from) {
        $('input[name="from"]').val(queryParams.from);
    }
    if (queryParams.to) {
        $('input[name="to"]').val(queryParams.to);
    }

contact= $('#contact_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
            url: '{{ route('lead.tableData') }}',
            type: 'GET',
            data: function(d) {
                d.from = $('input[name="from"]').val();
                d.to = $('input[name="to"]').val();
            },
            dataSrc: function(json) {
                return json.data.map(function(record) {
                    return {
                        id: record.id,
                        vin: record.vin,
                        name: record.user.name,
                        email: record.user.email,
                        phone: record.user.phone_number,
                        zip_code: record.user.zip_code,
                      
                        dealer_name: record.dealer ? record.dealer.name:'' ,
                        date: moment(record.created_at).format('DD-MM-YYYY HH:mm:ss')
                    };
                });
            }
    },
    columns: [
            { data: 'id', name: 'id' },
            { data: 'vin', name: 'vin' },
            { data: 'dealer_name', name: 'dealer_name' },

            { data: 'name', name: 'name' },
            { data: 'zip_code', name: 'zip_code' },
            { data: 'email', name: 'email' },
            { data: 'phone', name: 'phone' },
        
            { data: 'date', name: 'date' },
            {
            data: null,
            orderable: false, // Disable sorting on this column
            searchable: false, // Disable searching on this column
            render: function (data, type, row) {
                var deleteurl = `{{ route('request.delete') }}`+'?reqeust_id='+row.id;
                var showButton = `<a class="dropdown-item showContact" data-id="`+row.id+`">Show</a>`;
                var deleteButton = `<a class="dropdown-item" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('`+deleteurl+`')">Delete</a>`;
                return `
                        <div class="table_action dropdown">
                            <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                            <ul class="dropdown-menu">
                                <li>` + showButton + `</li>                   
                            </ul>
                        </div>
                    `;
            },
        },
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
                /* "oLanguage": {
            "sLengthMenu": "Display _MENU_ records per page",
            // other language options
        },*/

        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoFiltered: '(filtered from _MAX_ total records)',
        
    },
});

function actionmethod()
{
    actionsurl = $('#seturl').val();

    runajax(actionsurl, '', 'get', '', 'json', function(output) {
            
            console.log(output);
            if (output.success) 
            {
                $('.modal').modal('hide');
                contact.ajax.reload();

            }else{
                       
            }
    }); 
}

function seturl(url )
{
    $('#seturl').val(url);

}
</script>
@endsection
