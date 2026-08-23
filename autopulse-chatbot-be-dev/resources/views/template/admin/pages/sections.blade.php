<x-app-layout>

    <main class="main-content position-relative max-height-vh-100 h-100 border-radius-lg ">
        <x-app.navbar />
        <div class="container-fluid py-4 px-5">

            <div class="row">
                <div class="col-12">
                    <div class="card border shadow-xs mb-4">
                        <div class="card-header border-bottom pb-0">
                            <div class="d-sm-flex align-items-center">
                                <div>
                                    <h6 class="font-weight-semibold text-lg mb-0">Sections</h6>
                                    <p class="text-sm">See information about all pages</p>
                                </div>
                            </div>
                        </div>
                        <div class="card-body px-0 py-0">

                            <div class="table-responsive p-0">
                                <table class="table align-items-center mb-0">
                                    <thead class="bg-gray-100">
                                        <tr>
                                            <th class="text-secondary text-xs font-weight-semibold opacity-7 ps-2">#</th>
                                            <th class="text-secondary text-xs font-weight-semibold opacity-7 ps-2">Name</th>
                                            <th class="text-secondary text-xs font-weight-semibold opacity-7 ps-2">Section</th>
                                            <th class="text-secondary text-xs font-weight-semibold opacity-7 ps-2">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                                      
                                    @foreach ($forms as $data)
                                    <tr>
                                            <td>
                                                 <p class="text-sm text-secondary mb-0">{{ ++$i }}</p>
                                            </td>
                                            <td>
                                                 <p class="text-sm text-secondary mb-0">
                                                    {{ $data->name }}
                                                </p>
                                            </td>
                                            <td>
                                                 <p class="text-sm text-secondary mb-0">{{ $data->section_id }}</p>
                                            </td>
                                            <td class="align-middle">
                                            <div class="ms-auto d-flex">
                                                <a href="{{ URL('admin/read-form-builder', $data->id) }}" class="btn btn-sm btn-dark btn-icon d-flex align-items-center me-2 mb-0">
                                                        <span class="btn-inner--text">Show</span>
                                                </a>
                                            </div>

                                            </td>
                                        </tr>

                                        @endforeach
                                    </tbody>
                                </table>
                            </div>

                            <div class="border-top pt-3 px-3 d-flex align-items-center">
                                <div class="ms-auto">
                                    {!! $forms->links() !!}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
         
            <x-app.footer />
        </div>
    </main>

</x-app-layout>
