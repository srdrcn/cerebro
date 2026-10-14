import javax.inject.Inject

import play.api.http.{DefaultHttpFilters, EnabledFilters}
import play.filters.gzip.GzipFilter

class Filters @Inject() (enabledFilters: EnabledFilters, gzipFilter: GzipFilter)
  extends DefaultHttpFilters((enabledFilters.filters :+ gzipFilter): _*)
