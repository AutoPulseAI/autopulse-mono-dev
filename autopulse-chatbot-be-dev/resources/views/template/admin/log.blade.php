@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title">
            <h2>Logs</h2>
            <!-- <div class="page_title_btn">
                <div class="ms-auto d-md-flex align-items-end">  
                    <form action="" id="filter-form" method="GET">
                        <label>
                           From:<input type="date" name="from" class="form-control form-control-sm" value="{{Request::get('from')}}"> 
                        </label>
                        <label>
                            To:<input type="date" name="to" class="form-control form-control-sm" value="{{Request::get('to')}}"> 
                        </label>
                            <button type="submit" class="btn btn-primary me-2">Filter</button>
                            <a href="{{ route('lead.index') }}" class="btn btn-danger me-2">Reset</a>
                    </form>
                    <div class="position-relative text-end">
                        <button type="button" id="download-csv" class="btn btn-dark mb-2 dwn_csv_btn">Download CSV</button>
                    </div>
                </div> 
            </div> -->
        </div>
        
    </div>
    <hr>

    <div class="row">
        
        <div class="col col-12">
            <div class="position-relative table-responsive">
                <table class="table table-bordered w-100 dataTable" id="contact_tabl">
                    <thead>
                        <tr>
                            <td>#</td>
                            <td>Conversation Id</td>
                            <td>Req Time</td>
                            <td>Request</td>
                            <td>Res Time</td>
                            <td>Action</td>
                        </tr>
                    </thead>
                </table>

            </div>
        </div>
    </div>
</div>

 <!-- Show -->
 <div class="modal fade" id="showModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="adHeading" class="modal-title">Log</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                        <!-- Que Ans Start -->
                        <div class="row mb-3">
                            <div class="col col-11">
                                <p class="mb-1">Lorem ipsum dolor sit amet consectetur adipisicing elit.</p>
                                <p class="text-secondary mb-2"><small><small>18:30</small></small></p>
                            </div>
                            <div class="col col-11 ms-auto">
                                <div class="bg-light p-2">Lorem ipsum dolor sit amet consectetur adipisicing elit. Velit assumenda provident vitae blanditiis deserunt reprehenderit sed ad eos quasi repudiandae? Recusandae commodi quidem tenetur ad reiciendis doloribus quaerat deleniti veritatis?</div>
                                <p class="text-secondary"><small><small>18:30</small></small></p>
                            </div>
                        </div>
                        <!-- Que Ans End -->
                        
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
            $('#contact-dealername').text(data.dealer ? (data.dealer.name );
            $('#contact-dealerphone').text(data.dealer ? data.dealer.phone_number : '');
            $('#contact-dealeremail').text(data.dealer ? data.dealer.email : '');
            $('#contact-user_name').text(data.user ? (data.user.name + ' ' + data.user.last_name) : '');
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
                        date: moment(record.created_at).format('DD-MM-YYYY HH:mm:ss'),
                        name: 'Show me honda crv',
                     
                        // dealer_name: record.dealer ? record.dealer.name + ' ' + record.dealer.last_name : '',
                        // dealer_phone: record.dealer ? record.dealer.phone_number : '',
                        // website: record.dealer_source ? record.dealer_source: '',
                        date: moment(record.created_at).format('DD-MM-YYYY HH:mm:ss'),
                        action: `<button class="btn btn-primary btn-sm showContact" data-id="${record.id}">Show</button>`
                    };
                });
            }
    },
    columns: [
            { data: 'id', name: 'id' },
            { data: 'vin', name: 'vinn' },
            { data: 'date', name: 'date' },
            { data: 'name', name: 'name' },
         
            // { data: 'dealer_name', name: 'dealer_name' },
            // { data: 'dealer_phone', name: 'dealer_phone' },
            // { data: 'website', name: 'website' },
            { data: 'date', name: 'date' },
            { data: 'action', name: 'action', orderable: false, searchable: false }
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
